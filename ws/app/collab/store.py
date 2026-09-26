"""Postgres access for collaboration. Postgres is the authority; room memory is a cache.

Every query is parameterised, per the standing rule in ws/app/db.py.
"""

import json
import uuid
from pathlib import Path
from typing import Any, Callable

from .. import config, db
from .ops import apply_ops

SQL_DIR = Path(__file__).resolve().parent.parent / "sql"


async def ensure_schema() -> None:
    """Apply ws/app/sql/*.sql in name order. Every statement is idempotent."""
    async with db.pool().acquire() as conn:
        for path in sorted(SQL_DIR.glob("*.sql")):
            await conn.execute(path.read_text(encoding="utf-8"))


async def create_doc(owner_id: str, document: dict, title: str = "Untitled") -> str:
    doc_id = str(uuid.uuid4())
    async with db.pool().acquire() as conn, conn.transaction():
        await conn.execute(
            """
            INSERT INTO collab_doc (id, owner_id, title, rev, snapshot, snapshot_rev)
            VALUES ($1, $2, $3, 0, $4::jsonb, 0)
            """,
            doc_id,
            owner_id,
            title,
            json.dumps(document),
        )
        await conn.execute(
            "INSERT INTO collab_member (doc_id, user_id, role) VALUES ($1, $2, 'owner')",
            doc_id,
            owner_id,
        )
    return doc_id


async def load(doc_id: str) -> tuple[int, dict] | None:
    """Reconstitute the document at its current rev: snapshot plus replayed ops.

    Read at REPEATABLE READ so the snapshot and the op tail cannot disagree — otherwise a
    commit landing between the two reads would produce a document that is neither `rev`.
    """
    async with db.pool().acquire() as conn, conn.transaction(isolation="repeatable_read"):
        row = await conn.fetchrow(
            "SELECT rev, snapshot, snapshot_rev FROM collab_doc WHERE id = $1", doc_id
        )
        if row is None:
            return None
        tail = await conn.fetch(
            "SELECT ops FROM collab_op WHERE doc_id = $1 AND rev > $2 ORDER BY rev",
            doc_id,
            row["snapshot_rev"],
        )
    document = json.loads(row["snapshot"])
    for op_row in tail:
        apply_ops(document, json.loads(op_row["ops"]))
    return int(row["rev"]), document


async def ops_since(doc_id: str, have: int) -> list[dict]:
    """Ops a reconnecting client is missing, oldest first. Empty when it is already current."""
    rows = await db.pool().fetch(
        """
        SELECT rev, user_id, ops, hash
        FROM collab_op
        WHERE doc_id = $1 AND rev > $2
        ORDER BY rev
        """,
        doc_id,
        have,
    )
    return [
        {
            "rev": int(row["rev"]),
            "by": row["user_id"],
            "ops": json.loads(row["ops"]),
            "hash": row["hash"],
        }
        for row in rows
    ]


async def oldest_retained(doc_id: str) -> int | None:
    """Lowest rev still in the op log, so a caller knows whether replay is possible."""
    value = await db.pool().fetchval(
        "SELECT min(rev) FROM collab_op WHERE doc_id = $1", doc_id
    )
    return int(value) if value is not None else None


async def commit(
    doc_id: str, base: int, user_id: str, ops: list[dict], doc_hash: str | None
) -> int | None:
    """Allocate the next rev and append the ops, atomically. None means the base was stale.

    The WHERE rev = $2 makes this a compare-and-swap: concurrent committers serialise on
    the collab_doc row, and the loser gets zero rows back instead of a corrupt interleave.
    No advisory lock is needed.
    """
    return await db.pool().fetchval(
        """
        WITH bumped AS (
            UPDATE collab_doc SET rev = rev + 1, updated_at = now()
            WHERE id = $1 AND rev = $2
            RETURNING rev
        )
        INSERT INTO collab_op (doc_id, rev, user_id, ops, hash)
        SELECT $1, rev, $3, $4::jsonb, $5 FROM bumped
        RETURNING rev
        """,
        doc_id,
        base,
        user_id,
        json.dumps(ops),
        doc_hash,
    )


async def current_rev(doc_id: str) -> int | None:
    value = await db.pool().fetchval("SELECT rev FROM collab_doc WHERE id = $1", doc_id)
    return int(value) if value is not None else None


async def save_snapshot(doc_id: str, document: dict, rev: int) -> None:
    """Fold the op log into the snapshot. Keeps replay cheap and bounds table growth."""
    async with db.pool().acquire() as conn, conn.transaction():
        await conn.execute(
            """
            UPDATE collab_doc
            SET snapshot = $2::jsonb, snapshot_rev = $3, updated_at = now()
            WHERE id = $1 AND snapshot_rev < $3
            """,
            doc_id,
            json.dumps(document),
            rev,
        )
        # Keep a margin of history so a client that reconnects with an older `have` can
        # still replay instead of refetching the whole document.
        await conn.execute(
            "DELETE FROM collab_op WHERE doc_id = $1 AND rev <= $2",
            doc_id,
            rev - config.SNAPSHOT_EVERY,
        )


async def ensure_member(doc_id: str, user_id: str) -> None:
    """Link-as-capability: anyone authenticated who holds the doc id may join, and is
    recorded on first join. Tighten this to an invite check when accounts exist."""
    await db.pool().execute(
        """
        INSERT INTO collab_member (doc_id, user_id) VALUES ($1, $2)
        ON CONFLICT (doc_id, user_id) DO NOTHING
        """,
        doc_id,
        user_id,
    )


# ---- locks ---------------------------------------------------------------------------

def _owner(row: Any) -> dict:
    return {"user": row["user_id"], "conn": str(row["conn_id"]), "blockId": row["block_id"]}


async def list_locks(doc_id: str) -> list[dict]:
    rows = await db.pool().fetch(
        """
        SELECT block_id, user_id, conn_id FROM collab_lock
        WHERE doc_id = $1 AND expires_at > now()
        """,
        doc_id,
    )
    return [_owner(row) for row in rows]


async def acquire_lock(
    doc_id: str,
    conn_id: str,
    user_id: str,
    block_id: str,
    conflicts: Callable[[str, str], bool],
) -> tuple[bool, dict | None, list[str]]:
    """Take the lock on `block_id`, or report who holds a conflicting one.

    Returns (granted, blocking_owner, released_block_ids).

    The ancestor/descendant decision needs the block tree, which lives in the room, so it
    runs in Python via `conflicts` — but inside a transaction that holds the collab_doc row,
    which is the same serialisation point commits use. That makes check-then-set atomic
    across workers without a distributed lock or a Lua script.
    """
    async with db.pool().acquire() as conn, conn.transaction():
        exists = await conn.fetchval(
            "SELECT 1 FROM collab_doc WHERE id = $1 FOR UPDATE", doc_id
        )
        if exists is None:
            return False, None, []
        await conn.execute(
            "DELETE FROM collab_lock WHERE doc_id = $1 AND expires_at <= now()", doc_id
        )
        held = await conn.fetch(
            "SELECT block_id, user_id, conn_id FROM collab_lock WHERE doc_id = $1", doc_id
        )
        for row in held:
            if str(row["conn_id"]) == conn_id:
                continue
            if conflicts(block_id, row["block_id"]):
                return False, _owner(row), []
        # One lock per connection: taking a new one drops the old, which keeps the lock
        # table no larger than the number of collaborators.
        dropped = await conn.fetch(
            "DELETE FROM collab_lock WHERE doc_id = $1 AND conn_id = $2 RETURNING block_id",
            doc_id,
            uuid.UUID(conn_id),
        )
        await conn.execute(
            """
            INSERT INTO collab_lock (doc_id, block_id, user_id, conn_id, expires_at)
            VALUES ($1, $2, $3, $4, now() + ($5 || ' seconds')::interval)
            """,
            doc_id,
            block_id,
            user_id,
            uuid.UUID(conn_id),
            str(config.LOCK_TTL),
        )
    return True, None, [row["block_id"] for row in dropped if row["block_id"] != block_id]


async def release_locks(doc_id: str, conn_id: str, block_id: str | None = None) -> list[str]:
    """Drop this connection's lock (or one specific block). Returns what was released."""
    if block_id is None:
        rows = await db.pool().fetch(
            "DELETE FROM collab_lock WHERE doc_id = $1 AND conn_id = $2 RETURNING block_id",
            doc_id,
            uuid.UUID(conn_id),
        )
    else:
        rows = await db.pool().fetch(
            """
            DELETE FROM collab_lock
            WHERE doc_id = $1 AND conn_id = $2 AND block_id = $3
            RETURNING block_id
            """,
            doc_id,
            uuid.UUID(conn_id),
            block_id,
        )
    return [row["block_id"] for row in rows]


async def renew_locks(doc_id: str, conn_id: str) -> None:
    await db.pool().execute(
        """
        UPDATE collab_lock
        SET expires_at = now() + ($3 || ' seconds')::interval
        WHERE doc_id = $1 AND conn_id = $2
        """,
        doc_id,
        uuid.UUID(conn_id),
        str(config.LOCK_TTL),
    )


async def locks_for_commit(doc_id: str, conn_id: str) -> list[str]:
    """Live lock block ids held by this connection."""
    rows = await db.pool().fetch(
        """
        SELECT block_id FROM collab_lock
        WHERE doc_id = $1 AND conn_id = $2 AND expires_at > now()
        """,
        doc_id,
        uuid.UUID(conn_id),
    )
    return [row["block_id"] for row in rows]


async def foreign_locks(doc_id: str, conn_id: str) -> list[dict]:
    """Live locks held by *other* connections, for the commit authorisation check."""
    rows = await db.pool().fetch(
        """
        SELECT block_id, user_id, conn_id FROM collab_lock
        WHERE doc_id = $1 AND conn_id <> $2 AND expires_at > now()
        """,
        doc_id,
        uuid.UUID(conn_id),
    )
    return [_owner(row) for row in rows]
