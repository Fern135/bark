"""Canvas rooms: durable acknowledgments, ordered replay and transient presence."""
import asyncio
import contextlib
import time
import uuid

from . import bus, canvas_store
from .rooms import Connection
from canvas.collaboration_ops import OpError
from .presence import presence

_rooms = {}
_guard = asyncio.Lock()


class Room:
    def __init__(self, doc):
        self.doc = doc
        self.channel = f"bark:workspace:{doc}"
        self.connections = {}
        self.peers = {}
        self.task = None

    async def receive(self, payload):
        if payload.get("type") == "presence_event":
            conn = payload["peer"]["conn"]
            if payload.get("gone"):
                self.peers.pop(conn, None)
            else:
                self.peers[conn] = {**payload["peer"], "seen": time.monotonic()}
            self.broadcast({"type": "presence", "peers": self.live_peers()})
        else:
            self.broadcast(payload)

    def live_peers(self):
        self.peers = {k: v for k, v in self.peers.items() if time.monotonic() - v["seen"] < 8}
        return [{k: v for k, v in peer.items() if k != "seen"} for peer in self.peers.values()]

    def broadcast(self, payload):
        for conn in list(self.connections.values()):
            conn.send(payload)

    async def publish(self, payload):
        try:
            await bus.bus().publish(self.channel, payload)
        except Exception:
            # Database is authoritative. The reconciliation loop recovers missed fan-out.
            pass

    async def reconcile(self):
        while True:
            await asyncio.sleep(2)
            for conn in list(self.connections.values()):
                try:
                    state = await canvas_store.call("state", conn.user_id, self.doc)
                    conn.send({"type": "state", "rev": state["rev"], "locks": state["locks"], "members": state["members"]})
                    await self.publish({"type": "presence_event", "peer": {**conn.presence, "user": conn.user_id, "conn": conn.id, "resource": conn.resource}})
                except OpError:
                    conn.send({"type": "error", "code": "FORBIDDEN", "message": "Your access to this workspace ended."})
                    await conn.websocket.close(code=1008)
                except Exception:
                    conn.send({"type": "error", "code": "UNAVAILABLE", "message": "Live editing is temporarily unavailable."})


async def leave(conn):
    room = conn.room
    if not room:
        return
    conn.room = None
    room.connections.pop(conn.id, None)
    with contextlib.suppress(Exception):
        await canvas_store.call("release", conn.user_id, room.doc, conn.id)
        await room.publish({"type": "presence_event", "peer": {"conn": conn.id}, "gone": True})
    async with _guard:
        if not room.connections:
            if room.task:
                room.task.cancel()
            await bus.bus().unsubscribe(room.channel)
            _rooms.pop(room.doc, None)


async def handle(conn, message):
    kind = message.get("type")
    if kind == "join":
        if message.get("protocol") != 3:
            raise OpError("INVALID_OP", "Reload Bark to use collaboration protocol 3")
        doc = str(uuid.UUID(message["doc"]))
        state = await canvas_store.call("snapshot", conn.user_id, doc)
        await leave(conn)
        async with _guard:
            room = _rooms.get(doc)
            if room is None:
                room = Room(doc)
                _rooms[doc] = room
                await bus.bus().subscribe(room.channel, room.receive)
                room.task = asyncio.create_task(room.reconcile())
            room.connections[conn.id] = conn
            conn.room = room
            conn.resource = None
            conn.presence = {}
        # Read after subscribing so a concurrent commit is either in the snapshot or bus.
        state = await canvas_store.call("snapshot", conn.user_id, doc)
        have = message.get("have")
        replay = await canvas_store.call("replay", conn.user_id, doc, have) if isinstance(have, int) and have >= 0 else None
        if replay is None:
            conn.send(state)
        else:
            for frame in replay:
                conn.send(frame)
        conn.send({"type": "joined", "rev": state["rev"], "conn": conn.id, "members": state["members"], "locks": state["locks"]})
        await room.publish({"type": "presence_event", "peer": {"user": conn.user_id, "conn": conn.id, "resource": None}})
        conn.send({"type": "presence", "peers": room.live_peers()})
        return
    room = conn.room
    if room is None:
        raise OpError("FORBIDDEN", "Join a workspace first")
    if kind == "sync":
        state = await canvas_store.call("snapshot", conn.user_id, room.doc)
        have = message.get("have")
        replay = await canvas_store.call("replay", conn.user_id, room.doc, have) if isinstance(have, int) and have >= 0 else None
        for frame in replay if replay is not None else [state]:
            conn.send(frame)
        conn.send({"type": "joined", "rev": state["rev"], "conn": conn.id, "members": state["members"], "locks": state["locks"]})
    elif kind == "presence":
        if not conn.presence_rate.take():
            return
        value = presence(message)
        if value.get("preview"):
            state = await canvas_store.call("state", conn.user_id, room.doc)
            if not any(lock["conn"] == conn.id and lock["resource"] in ("*", f'entity:{value["preview"]["id"]}') for lock in state["locks"]):
                value["preview"] = None
        conn.presence = value
        await room.publish({"type": "presence_event", "peer": {**value, "user": conn.user_id, "conn": conn.id, "resource": conn.resource}})
    elif kind == "lock":
        resources = message.get("resources")
        if not isinstance(resources, list) or not 0 < len(resources) <= 64 or any(not isinstance(r, str) or len(r) > 256 for r in resources):
            raise OpError("INVALID_OP", "Invalid lock resources")
        if not conn.locks.take():
            raise OpError("LIMIT_EXCEEDED", "Too many lock requests")
        locks = await canvas_store.call("acquire", conn.user_id, room.doc, conn.id, resources)
        conn.resource = resources[0]
        conn.send({"type": "locked", "nonce": message.get("nonce"), "locks": locks})
        await room.publish({"type": "locks", "locks": locks})
    elif kind == "unlock":
        await canvas_store.call("release", conn.user_id, room.doc, conn.id)
        conn.resource = None
        state = await canvas_store.call("state", conn.user_id, room.doc)
        await room.publish({"type": "locks", "locks": state["locks"]})
    elif kind == "commit":
        ops = message.get("ops")
        if not isinstance(ops, list) or not 0 < len(ops) <= 64 or not isinstance(message.get("base"), int):
            raise OpError("INVALID_OP", "Invalid commit")
        if not conn.commits.take():
            raise OpError("LIMIT_EXCEEDED", "Too many edits")
        frame = await canvas_store.call("commit", conn.user_id, room.doc, conn.id, message["commitId"], message["base"], ops)
        conn.send({"type": "ack", "commitId": message["commitId"], "rev": frame["rev"]})
        if frame["type"] == "patch":
            await room.publish(frame)
    elif kind == "heartbeat":
        state = await canvas_store.call("state", conn.user_id, room.doc, conn.id)
        conn.send({"type": "state", "rev": state["rev"], "locks": state["locks"], "members": state["members"]})
    else:
        raise OpError("INVALID_OP", "Unknown message type")


async def shutdown():
    for room in list(_rooms.values()):
        if room.task:
            room.task.cancel()
        for conn in list(room.connections.values()):
            await conn.websocket.close(code=1001)
    _rooms.clear()
