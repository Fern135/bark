"""Rooms: one per open document, holding the connections editing it.

Invariants worth keeping in mind while reading:

* A commit is validated against room memory, but *allocated* by a compare-and-swap in
  Postgres, so two workers can never both win the same rev.
* A worker never delivers its own commit directly. It publishes to the bus and the bus
  delivers to everyone including itself, so every client sees revs in one order.
* The room applies ops only from the bus, strictly at `rev + 1`. Any gap means this worker
  missed a message, and the only safe response is to reload from Postgres and re-snapshot.
* One lock per connection, covering that block's whole subtree. Locks are released on
  disconnect, and expire on their own only if a client crashes.
"""

import asyncio
import contextlib
import json
import logging
import time
import uuid
from typing import Any

from fastapi import WebSocket

from .. import config
from . import ops as doc_ops
from . import protocol, store
from .bus import bus, channel_for

log = logging.getLogger("bark.collab")


class TokenBucket:
    """Per-connection rate limit, mirroring the queue caps in scripting/src/session.ts."""

    def __init__(self, rate: float, burst: float | None = None) -> None:
        self._rate = rate
        self._capacity = burst if burst is not None else rate
        self._tokens = self._capacity
        self._updated = time.monotonic()

    def take(self, amount: float = 1.0) -> bool:
        now = time.monotonic()
        self._tokens = min(self._capacity, self._tokens + (now - self._updated) * self._rate)
        self._updated = now
        if self._tokens < amount:
            return False
        self._tokens -= amount
        return True


class Connection:
    """One websocket. Writes go through a bounded queue drained by a dedicated task, so a
    slow client cannot stall the room — it gets dropped instead."""

    def __init__(self, websocket: WebSocket, user_id: str) -> None:
        self.websocket = websocket
        self.user_id = user_id
        self.id = str(uuid.uuid4())
        self.room: "Room | None" = None
        self.commits = TokenBucket(config.RATE_COMMITS)
        self.locks = TokenBucket(config.RATE_LOCKS)
        self._queue: asyncio.Queue[dict | None] = asyncio.Queue(maxsize=config.SEND_QUEUE_MAX)
        self._writer: asyncio.Task | None = None
        self.overflowed = False

    def start(self) -> None:
        self._writer = asyncio.create_task(self._drain(), name=f"collab-writer-{self.id}")

    async def _drain(self) -> None:
        while True:
            frame = await self._queue.get()
            if frame is None:
                return
            try:
                await self.websocket.send_json(frame)
            except Exception:
                return

    def send(self, frame: dict) -> None:
        """Queue a frame, or drop the client if it has stopped reading.

        Closing here rather than only on the receive path matters: a client that reads
        nothing and sends nothing would otherwise sit in the room forever, holding a lock.
        """
        try:
            self._queue.put_nowait(frame)
        except asyncio.QueueFull:
            if not self.overflowed:
                self.overflowed = True
                asyncio.create_task(self._close_overflowed(), name=f"collab-drop-{self.id}")

    async def _close_overflowed(self) -> None:
        log.warning("collab: send queue overflow for user %s; dropping", self.user_id)
        with contextlib.suppress(Exception):
            await self.websocket.close(code=1011)

    async def stop(self) -> None:
        with contextlib.suppress(asyncio.QueueFull):
            self._queue.put_nowait(None)
        if self._writer is not None:
            self._writer.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._writer
            self._writer = None

    def peer(self, block_id: str | None = None) -> dict:
        return {"user": self.user_id, "conn": self.id, "blockId": block_id}


class Room:
    def __init__(self, doc_id: str) -> None:
        self.doc_id = doc_id
        self.channel = channel_for(doc_id)
        self.document: dict = {}
        self.rev = -1
        self.index: dict[str, doc_ops.Node] = {}
        self.connections: dict[str, Connection] = {}
        self.presence: dict[str, dict] = {}
        self.locks: dict[str, dict] = {}
        self._apply = asyncio.Lock()
        self._buffer: list[dict] | None = []
        self._since_snapshot = 0
        self._sweeper: asyncio.Task | None = None

    # ---- lifecycle ------------------------------------------------------------

    async def open(self) -> bool:
        """Subscribe first, then load. Buffering across the load closes the race where a
        commit lands between our read and our first delivery."""
        await bus().subscribe(self.channel, self._on_bus)
        loaded = await store.load(self.doc_id)
        if loaded is None:
            await bus().unsubscribe(self.channel)
            return False
        self.rev, self.document = loaded
        self.reindex()
        buffered, self._buffer = self._buffer or [], None
        for payload in buffered:
            await self._on_bus(payload)
        self.locks = {lock["blockId"]: lock for lock in await store.list_locks(self.doc_id)}
        self._sweeper = asyncio.create_task(self._sweep(), name=f"collab-sweep-{self.doc_id}")
        return True

    async def close(self) -> None:
        if self._sweeper is not None:
            self._sweeper.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._sweeper
            self._sweeper = None
        await bus().unsubscribe(self.channel)
        if self.rev >= 0 and self._since_snapshot:
            with contextlib.suppress(Exception):
                await store.save_snapshot(self.doc_id, self.document, self.rev)

    def reindex(self) -> None:
        try:
            self.index = doc_ops.build_index(doc_ops.workspace_of(self.document))
        except doc_ops.OpError:
            self.index = {}

    def conflicts(self, requested: str, held: str) -> bool:
        return doc_ops.conflicts(self.index, requested, held)

    # ---- bus ------------------------------------------------------------------

    async def _on_bus(self, payload: dict) -> None:
        if self._buffer is not None:
            self._buffer.append(payload)
            return
        kind = payload.get("kind")
        if kind == "op":
            await self._on_remote_op(payload)
        elif kind == "lock":
            for change in payload.get("locks", []):
                block_id, owner = change.get("blockId"), change.get("owner")
                if owner:
                    self.locks[block_id] = owner
                else:
                    self.locks.pop(block_id, None)
                self.broadcast(protocol.lock_state(block_id, owner))
        elif kind == "presence":
            peer = payload.get("peer") or {}
            conn_id = peer.get("conn")
            if not conn_id:
                return
            if payload.get("gone"):
                self.presence.pop(conn_id, None)
            else:
                self.presence[conn_id] = peer
            self.broadcast(protocol.presence(list(self.presence.values())))

    async def _on_remote_op(self, payload: dict) -> None:
        rev = int(payload.get("rev", -1))
        async with self._apply:
            if rev <= self.rev:
                return  # already applied; publishing is at-least-once
            if rev != self.rev + 1:
                log.warning(
                    "collab: rev gap on doc %s (have %s, got %s); reloading",
                    self.doc_id, self.rev, rev,
                )
                await self._reload()
                return
            candidate = json.loads(json.dumps(self.document))
            try:
                doc_ops.apply_ops(candidate, payload["ops"])
            except doc_ops.OpError:
                log.exception("collab: bus op did not apply to doc %s; reloading", self.doc_id)
                await self._reload()
                return
            self.document = candidate
            self.rev = rev
            self.reindex()
            self._since_snapshot += 1
        self.broadcast(
            protocol.patch(rev, payload["ops"], payload.get("by", ""), payload.get("hash"))
        )
        if self._since_snapshot >= config.SNAPSHOT_EVERY:
            self._since_snapshot = 0
            with contextlib.suppress(Exception):
                await store.save_snapshot(self.doc_id, self.document, self.rev)

    async def _reload(self) -> None:
        """Self-heal after a gap: refetch from the authority and re-snapshot every client."""
        loaded = await store.load(self.doc_id)
        if loaded is None:
            return
        self.rev, self.document = loaded
        self.reindex()
        self.locks = {lock["blockId"]: lock for lock in await store.list_locks(self.doc_id)}
        for conn in self.connections.values():
            conn.send(self.snapshot_frame())

    def snapshot_frame(self) -> dict:
        return protocol.snapshot(
            self.doc_id,
            self.rev,
            self.document,
            list(self.locks.values()),
            list(self.presence.values()),
        )

    def broadcast(self, frame: dict, skip: str | None = None) -> None:
        for conn_id, conn in self.connections.items():
            if conn_id != skip:
                conn.send(frame)

    # ---- locks ----------------------------------------------------------------

    async def _sweep(self) -> None:
        """Tell the room when a crashed client's lock lapses. Nothing else notices a TTL."""
        interval = max(2.0, config.LOCK_TTL / 3)
        while True:
            await asyncio.sleep(interval)
            try:
                live = {lock["blockId"]: lock for lock in await store.list_locks(self.doc_id)}
            except Exception:
                log.exception("collab: lock sweep failed for doc %s", self.doc_id)
                continue
            for block_id in set(self.locks) - set(live):
                self.locks.pop(block_id, None)
                self.broadcast(protocol.lock_state(block_id, None))

    async def acquire(self, conn: Connection, block_id: str, nonce: int) -> None:
        granted, owner, released = await store.acquire_lock(
            self.doc_id, conn.id, conn.user_id, block_id, self.conflicts
        )
        if not granted:
            if owner is None:
                # The document row vanished under us, which is not a lock conflict.
                conn.send(protocol.error("NOT_FOUND", "This document is no longer available."))
                return
            conn.send(protocol.lock_state(block_id, owner, nonce))
            conn.send(protocol.error("LOCK_HELD", f"{owner['user']} is editing that."))
            return
        changes = [{"blockId": block_id, "owner": conn.peer(block_id)}]
        changes += [{"blockId": freed, "owner": None} for freed in released]
        conn.send(protocol.lock_state(block_id, conn.peer(block_id), nonce))
        await bus().publish(self.channel, {"kind": "lock", "locks": changes})

    async def release(self, conn: Connection, block_id: str | None = None) -> None:
        released = await store.release_locks(self.doc_id, conn.id, block_id)
        if released:
            await bus().publish(
                self.channel,
                {"kind": "lock", "locks": [{"blockId": b, "owner": None} for b in released]},
            )

    # ---- commit ---------------------------------------------------------------

    async def commit(self, conn: Connection, message: protocol.Commit) -> None:
        if not conn.commits.take():
            conn.send(protocol.error("LIMIT_EXCEEDED", "Too many edits at once; slow down."))
            return

        raw_ops = [op.model_dump() for op in message.ops]
        try:
            protocol.check_depth(raw_ops)
        except protocol.ProtocolError as exc:
            conn.send(protocol.error(exc.code, exc.message))
            return

        if message.base != self.rev:
            conn.send(protocol.error("REV_MISMATCH", "Your copy is behind.", self.rev))
            return

        # Authorisation runs against the pre-commit tree: the primary block of each op must
        # be covered by a lock this connection holds, and nothing the op touches may be
        # covered by someone else's lock.
        held = await store.locks_for_commit(self.doc_id, conn.id)
        foreign = await store.foreign_locks(self.doc_id, conn.id)
        for op in raw_ops:
            first = doc_ops.primary(op)
            if first is not None and not any(self.conflicts(first, lock) for lock in held):
                conn.send(
                    protocol.error("NOT_LOCKED", f"Lock {first} before editing it.")
                )
                return
            for target in doc_ops.touched(op):
                for lock in foreign:
                    if self.conflicts(target, lock["blockId"]):
                        conn.send(protocol.lock_state(lock["blockId"], lock))
                        conn.send(
                            protocol.error("LOCK_HELD", f"{lock['user']} is editing {target}.")
                        )
                        return

        candidate = json.loads(json.dumps(self.document))
        try:
            doc_ops.apply_ops(candidate, raw_ops)
        except doc_ops.OpError as exc:
            conn.send(protocol.error(exc.code, exc.message))
            return

        server_hash = doc_ops.workspace_hash(candidate)
        if message.hash and message.hash != server_hash:
            # Not fatal: the client resyncs off the hash we put in the patch. Logged because
            # a steady stream of these means the two diff implementations have drifted.
            log.warning(
                "collab: hash mismatch on doc %s rev %s (client %s, server %s)",
                self.doc_id, self.rev + 1, message.hash, server_hash,
            )

        rev = await store.commit(self.doc_id, message.base, conn.user_id, raw_ops, server_hash)
        if rev is None:
            current = await store.current_rev(self.doc_id)
            conn.send(protocol.error("REV_MISMATCH", "Someone committed first.", current))
            return

        conn.send(protocol.ack(message.nonce, int(rev)))
        await bus().publish(
            self.channel,
            {
                "kind": "op",
                "rev": int(rev),
                "ops": raw_ops,
                "by": conn.user_id,
                "hash": server_hash,
            },
        )

    # ---- presence -------------------------------------------------------------

    async def announce(self, conn: Connection, block_id: str | None, gone: bool = False) -> None:
        await bus().publish(
            self.channel,
            {"kind": "presence", "peer": conn.peer(block_id), "gone": gone},
        )


_rooms: dict[str, Room] = {}
_rooms_guard = asyncio.Lock()


async def join(conn: Connection, message: protocol.Join) -> Room | None:
    """Create or open a document and put this connection in its room."""
    doc_id = message.doc
    if doc_id == "new":
        document = message.document
        if not isinstance(document, dict):
            conn.send(protocol.error("INVALID_OP", "join {doc:'new'} needs a document."))
            return None
        try:
            protocol.check_depth(document)
            # Refuse to create a document nothing can edit; the error is far clearer now
            # than on the first commit.
            doc_ops.build_index(doc_ops.workspace_of(document))
        except protocol.ProtocolError as exc:
            conn.send(protocol.error(exc.code, exc.message))
            return None
        except doc_ops.OpError as exc:
            conn.send(protocol.error(exc.code, exc.message))
            return None
        doc_id = await store.create_doc(conn.user_id, document)
    else:
        try:
            uuid.UUID(doc_id)
        except ValueError:
            conn.send(protocol.error("NOT_FOUND", "That is not a document id."))
            return None
        if await store.current_rev(doc_id) is None:
            conn.send(protocol.error("NOT_FOUND", "No such document."))
            return None
        await store.ensure_member(doc_id, conn.user_id)

    async with _rooms_guard:
        room = _rooms.get(doc_id)
        if room is None:
            room = Room(doc_id)
            if not await room.open():
                conn.send(protocol.error("NOT_FOUND", "No such document."))
                return None
            _rooms[doc_id] = room

    room.connections[conn.id] = conn
    conn.room = room

    # `have` lets a reconnecting client replay instead of refetching, but only while the
    # ops it missed are still retained.
    replayed = False
    if message.have is not None and 0 <= message.have <= room.rev:
        oldest = await store.oldest_retained(doc_id)
        if message.have == room.rev or (oldest is not None and oldest <= message.have + 1):
            for entry in await store.ops_since(doc_id, message.have):
                conn.send(protocol.patch(entry["rev"], entry["ops"], entry["by"], entry["hash"]))
            replayed = True
    if not replayed:
        conn.send(room.snapshot_frame())

    await room.announce(conn, None)
    return room


async def leave(conn: Connection) -> None:
    room = conn.room
    conn.room = None
    if room is None:
        return
    room.connections.pop(conn.id, None)
    with contextlib.suppress(Exception):
        await room.release(conn)
    with contextlib.suppress(Exception):
        await room.announce(conn, None, gone=True)
    if not room.connections:
        async with _rooms_guard:
            if not room.connections and _rooms.get(room.doc_id) is room:
                del _rooms[room.doc_id]
                await room.close()


async def shutdown() -> None:
    async with _rooms_guard:
        for room in list(_rooms.values()):
            await room.close()
        _rooms.clear()


async def handle(conn: Connection, message: Any) -> None:
    """Route one validated client frame."""
    kind = message.type
    if kind == "join":
        if conn.room is not None:
            await leave(conn)
        await join(conn, message)
        return

    room = conn.room
    if room is None:
        conn.send(protocol.error("INVALID_OP", "Join a document first."))
        return

    if kind == "commit":
        await room.commit(conn, message)
    elif kind == "lock":
        if not conn.locks.take():
            conn.send(protocol.error("LIMIT_EXCEEDED", "Too many lock requests."))
            return
        await room.acquire(conn, message.blockId, message.nonce)
    elif kind == "unlock":
        await room.release(conn, message.blockId)
    elif kind == "presence":
        await room.announce(conn, message.blockId)
    elif kind == "heartbeat":
        await store.renew_locks(room.doc_id, conn.id)
    else:
        conn.send(protocol.error("INVALID_OP", f"Unexpected {kind!r} here."))
