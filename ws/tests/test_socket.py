"""End-to-end websocket tests: auth, join, commit ordering, and lock ownership.

These need a real Postgres, because rev allocation is a compare-and-swap in the database
and lock acquisition happens inside a transaction — mocking either would test nothing.

Point WS_TEST_DSN at a throwaway database and the suite runs; otherwise it skips:

    docker compose up -d db
    WS_TEST_DSN=postgres://bark:bark@127.0.0.1:5432/bark pytest ws/tests/test_socket.py

The bus is left unset, so these exercise the in-process fan-out path (one worker).
"""

import json
import os
import time
import uuid

import jwt
import pytest

DSN = os.environ.get("WS_TEST_DSN")
pytestmark = pytest.mark.skipif(not DSN, reason="set WS_TEST_DSN to run websocket tests")

ORIGIN = "http://localhost:8080"
DOCUMENT = {
    "version": 1,
    "project": {"entities": []},
    "script": {
        "language": "blocks",
        "workspace": {
            "variables": [],
            "blocks": {
                "languageVersion": 0,
                "blocks": [
                    {
                        "type": "bark_start",
                        "id": "start",
                        "x": 30,
                        "y": 30,
                        "inputs": {"DO": {"block": {"type": "bark_notify", "id": "n1"}}},
                    },
                    {"type": "bark_loose", "id": "loose", "x": 400, "y": 40},
                ],
            },
        },
    },
}


@pytest.fixture(scope="module", autouse=True)
def environment():
    """Point the app at the test database before app.config is imported anywhere."""
    if DSN:
        from urllib.parse import urlparse

        parsed = urlparse(DSN)
        os.environ["POSTGRES_HOST"] = parsed.hostname or "127.0.0.1"
        os.environ["POSTGRES_PORT"] = str(parsed.port or 5432)
        os.environ["POSTGRES_DB"] = (parsed.path or "/bark").lstrip("/")
        os.environ["POSTGRES_USER"] = parsed.username or "bark"
        os.environ["POSTGRES_PASSWORD"] = parsed.password or "bark"
    os.environ["WS_AUTO_MIGRATE"] = "1"
    os.environ["WS_ALLOWED_ORIGINS"] = ORIGIN
    os.environ["REDIS_URL"] = ""
    yield


@pytest.fixture(scope="module")
def client(environment):
    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app) as test_client:
        yield test_client


def token_for(user: str = "user-1") -> str:
    from app import config

    now = int(time.time())
    return jwt.encode(
        {
            "sub": user,
            "iat": now,
            "exp": now + 300,
            "iss": config.JWT_ISSUER,
            "aud": config.JWT_AUDIENCE,
            "type": "access",
        },
        config.JWT_SECRET,
        algorithm=config.JWT_ALGORITHM,
    )


def open_socket(client, user: str = "user-1"):
    """Connect, authenticate, and return the socket once it is ready."""
    socket = client.websocket_connect("/ws/", headers={"origin": ORIGIN}).__enter__()
    socket.send_json({"type": "auth", "token": token_for(user)})
    ready = socket.receive_json()
    assert ready == {"type": "ready", "user": user}
    return socket


def drain_until(socket, kind: str, limit: int = 20) -> dict:
    """Read frames until one of `kind` shows up. Presence chatter is interleaved."""
    for _ in range(limit):
        frame = socket.receive_json()
        if frame.get("type") == kind:
            return frame
    raise AssertionError(f"no {kind} frame within {limit} frames")


# ---- auth and origin -----------------------------------------------------------------

def test_a_foreign_origin_is_refused(client):
    from starlette.websockets import WebSocketDisconnect

    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/ws/", headers={"origin": "http://evil.example"}) as socket:
            socket.receive_json()


def test_a_bad_token_is_refused(client):
    from starlette.websockets import WebSocketDisconnect

    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/ws/", headers={"origin": ORIGIN}) as socket:
            socket.send_json({"type": "auth", "token": "not-a-jwt"})
            socket.receive_json()


def test_work_before_join_is_refused(client):
    socket = open_socket(client)
    socket.send_json({"type": "lock", "blockId": "start", "nonce": 1})
    frame = drain_until(socket, "error")
    assert frame["code"] == "INVALID_OP"
    socket.close()


# ---- join ----------------------------------------------------------------------------

def test_join_new_returns_a_snapshot_at_rev_zero(client):
    socket = open_socket(client)
    socket.send_json({"type": "join", "doc": "new", "document": DOCUMENT})
    snapshot = drain_until(socket, "snapshot")
    assert snapshot["rev"] == 0
    assert uuid.UUID(snapshot["doc"])
    assert snapshot["document"]["script"]["workspace"]["blocks"]["blocks"][0]["id"] == "start"
    assert snapshot["locks"] == []
    socket.close()


def test_join_unknown_document_is_not_found(client):
    socket = open_socket(client)
    socket.send_json({"type": "join", "doc": str(uuid.uuid4())})
    assert drain_until(socket, "error")["code"] == "NOT_FOUND"
    socket.close()


def test_join_new_without_a_document_is_rejected(client):
    socket = open_socket(client)
    socket.send_json({"type": "join", "doc": "new"})
    assert drain_until(socket, "error")["code"] == "INVALID_OP"
    socket.close()


def test_a_late_joiner_sees_the_committed_state(client):
    author = open_socket(client, "user-1")
    author.send_json({"type": "join", "doc": "new", "document": DOCUMENT})
    doc_id = drain_until(author, "snapshot")["doc"]

    author.send_json({"type": "lock", "blockId": "loose", "nonce": 1})
    drain_until(author, "lock_state")
    author.send_json({
        "type": "commit",
        "base": 0,
        "ops": [{"op": "move", "id": "loose", "x": 999, "y": 111}],
        "nonce": 2,
    })
    assert drain_until(author, "ack")["rev"] == 1

    joiner = open_socket(client, "user-2")
    joiner.send_json({"type": "join", "doc": doc_id})
    snapshot = drain_until(joiner, "snapshot")
    assert snapshot["rev"] == 1
    roots = snapshot["document"]["script"]["workspace"]["blocks"]["blocks"]
    assert [r for r in roots if r["id"] == "loose"][0]["x"] == 999
    # The author's lock is visible to the joiner, which is what greys the block out.
    assert [lock["blockId"] for lock in snapshot["locks"]] == ["loose"]

    joiner.close()
    author.close()


# ---- commits -------------------------------------------------------------------------

def test_a_commit_without_a_lock_is_refused(client):
    socket = open_socket(client)
    socket.send_json({"type": "join", "doc": "new", "document": DOCUMENT})
    drain_until(socket, "snapshot")
    socket.send_json({
        "type": "commit",
        "base": 0,
        "ops": [{"op": "move", "id": "loose", "x": 1, "y": 1}],
        "nonce": 1,
    })
    assert drain_until(socket, "error")["code"] == "NOT_LOCKED"
    socket.close()


def test_a_stale_base_is_a_rev_mismatch(client):
    socket = open_socket(client)
    socket.send_json({"type": "join", "doc": "new", "document": DOCUMENT})
    drain_until(socket, "snapshot")
    socket.send_json({"type": "lock", "blockId": "loose", "nonce": 1})
    drain_until(socket, "lock_state")
    socket.send_json({
        "type": "commit",
        "base": 7,
        "ops": [{"op": "move", "id": "loose", "x": 1, "y": 1}],
        "nonce": 2,
    })
    frame = drain_until(socket, "error")
    assert frame["code"] == "REV_MISMATCH"
    assert frame["rev"] == 0
    socket.close()


def test_a_commit_is_broadcast_to_everyone(client):
    author = open_socket(client, "user-1")
    author.send_json({"type": "join", "doc": "new", "document": DOCUMENT})
    doc_id = drain_until(author, "snapshot")["doc"]

    watcher = open_socket(client, "user-2")
    watcher.send_json({"type": "join", "doc": doc_id})
    drain_until(watcher, "snapshot")

    author.send_json({"type": "lock", "blockId": "loose", "nonce": 1})
    drain_until(author, "lock_state")
    author.send_json({
        "type": "commit",
        "base": 0,
        "ops": [{"op": "move", "id": "loose", "x": 42, "y": 42}],
        "nonce": 2,
    })
    drain_until(author, "ack")

    patch = drain_until(watcher, "patch")
    assert patch["rev"] == 1
    assert patch["by"] == "user-1"
    assert patch["ops"] == [{"op": "move", "id": "loose", "x": 42, "y": 42}]
    assert patch["hash"]
    # The author gets the same patch, so both sides run one apply path.
    assert drain_until(author, "patch")["rev"] == 1

    watcher.close()
    author.close()


def test_an_inapplicable_op_is_rejected_and_does_not_burn_a_rev(client):
    socket = open_socket(client)
    socket.send_json({"type": "join", "doc": "new", "document": DOCUMENT})
    drain_until(socket, "snapshot")
    socket.send_json({"type": "lock", "blockId": "start", "nonce": 1})
    drain_until(socket, "lock_state")
    # `start` is a root, so moving its child is fine, but this id does not exist at all.
    socket.send_json({
        "type": "commit",
        "base": 0,
        "ops": [{"op": "delete", "id": "ghost"}],
        "nonce": 2,
    })
    assert drain_until(socket, "error")["code"] in {"NOT_FOUND", "NOT_LOCKED"}

    socket.send_json({
        "type": "commit",
        "base": 0,
        "ops": [{"op": "replace", "id": "start", "block": {"type": "bark_start"}}],
        "nonce": 3,
    })
    assert drain_until(socket, "ack")["rev"] == 1
    socket.close()


# ---- locks ---------------------------------------------------------------------------

def test_a_conflicting_lock_is_denied_with_its_owner(client):
    holder = open_socket(client, "user-1")
    holder.send_json({"type": "join", "doc": "new", "document": DOCUMENT})
    doc_id = drain_until(holder, "snapshot")["doc"]
    holder.send_json({"type": "lock", "blockId": "start", "nonce": 1})
    assert drain_until(holder, "lock_state")["owner"]["user"] == "user-1"

    rival = open_socket(client, "user-2")
    rival.send_json({"type": "join", "doc": doc_id})
    drain_until(rival, "snapshot")

    # n1 is a descendant of start, so the ancestor's lock covers it.
    rival.send_json({"type": "lock", "blockId": "n1", "nonce": 2})
    denied = drain_until(rival, "error")
    assert denied["code"] == "LOCK_HELD"

    rival.close()
    holder.close()


def test_an_unrelated_stack_can_be_locked_concurrently(client):
    first = open_socket(client, "user-1")
    first.send_json({"type": "join", "doc": "new", "document": DOCUMENT})
    doc_id = drain_until(first, "snapshot")["doc"]
    first.send_json({"type": "lock", "blockId": "start", "nonce": 1})
    drain_until(first, "lock_state")

    second = open_socket(client, "user-2")
    second.send_json({"type": "join", "doc": doc_id})
    drain_until(second, "snapshot")
    second.send_json({"type": "lock", "blockId": "loose", "nonce": 2})
    granted = drain_until(second, "lock_state")
    assert granted["owner"]["user"] == "user-2"
    assert granted["blockId"] == "loose"

    second.close()
    first.close()


def test_one_lock_per_connection_releases_the_previous(client):
    socket = open_socket(client)
    socket.send_json({"type": "join", "doc": "new", "document": DOCUMENT})
    drain_until(socket, "snapshot")
    socket.send_json({"type": "lock", "blockId": "start", "nonce": 1})
    drain_until(socket, "lock_state")
    socket.send_json({"type": "lock", "blockId": "loose", "nonce": 2})

    seen = {}
    for _ in range(12):
        frame = socket.receive_json()
        if frame.get("type") == "lock_state":
            seen[frame["blockId"]] = frame["owner"]
        if "start" in seen and seen.get("loose"):
            break
    assert seen.get("loose"), "the new lock was never granted"
    assert seen.get("start") is None, "the previous lock was not released"
    socket.close()


def test_unlock_frees_the_block_for_someone_else(client):
    holder = open_socket(client, "user-1")
    holder.send_json({"type": "join", "doc": "new", "document": DOCUMENT})
    doc_id = drain_until(holder, "snapshot")["doc"]
    holder.send_json({"type": "lock", "blockId": "start", "nonce": 1})
    drain_until(holder, "lock_state")
    holder.send_json({"type": "unlock", "blockId": "start"})
    drain_until(holder, "lock_state")

    rival = open_socket(client, "user-2")
    rival.send_json({"type": "join", "doc": doc_id})
    drain_until(rival, "snapshot")
    rival.send_json({"type": "lock", "blockId": "start", "nonce": 2})
    assert drain_until(rival, "lock_state")["owner"]["user"] == "user-2"

    rival.close()
    holder.close()


def test_disconnecting_releases_the_lock(client):
    holder = open_socket(client, "user-1")
    holder.send_json({"type": "join", "doc": "new", "document": DOCUMENT})
    doc_id = drain_until(holder, "snapshot")["doc"]
    holder.send_json({"type": "lock", "blockId": "start", "nonce": 1})
    drain_until(holder, "lock_state")
    holder.close()

    rival = open_socket(client, "user-2")
    rival.send_json({"type": "join", "doc": doc_id})
    drain_until(rival, "snapshot")
    rival.send_json({"type": "lock", "blockId": "start", "nonce": 2})
    assert drain_until(rival, "lock_state")["owner"]["user"] == "user-2"
    rival.close()


def test_dropping_a_block_into_a_locked_stack_is_refused(client):
    holder = open_socket(client, "user-1")
    holder.send_json({"type": "join", "doc": "new", "document": DOCUMENT})
    doc_id = drain_until(holder, "snapshot")["doc"]
    holder.send_json({"type": "lock", "blockId": "start", "nonce": 1})
    drain_until(holder, "lock_state")

    rival = open_socket(client, "user-2")
    rival.send_json({"type": "join", "doc": doc_id})
    drain_until(rival, "snapshot")
    rival.send_json({"type": "lock", "blockId": "loose", "nonce": 2})
    drain_until(rival, "lock_state")
    # It owns `loose`, but the target parent belongs to user-1.
    rival.send_json({
        "type": "commit",
        "base": 0,
        "ops": [{"op": "attach", "id": "loose", "parent": "start", "connection": {"next": True}}],
        "nonce": 3,
    })
    assert drain_until(rival, "error")["code"] == "LOCK_HELD"

    rival.close()
    holder.close()


# ---- limits --------------------------------------------------------------------------

def test_an_oversized_frame_closes_the_socket(client):
    from app import config
    from starlette.websockets import WebSocketDisconnect

    socket = open_socket(client)
    with pytest.raises(WebSocketDisconnect):
        socket.send_text(json.dumps({"type": "presence", "pad": "x" * (config.MAX_MESSAGE_BYTES + 10)}))
        socket.receive_json()


def test_a_malformed_frame_does_not_close_the_socket(client):
    socket = open_socket(client)
    socket.send_text("{not json")
    assert drain_until(socket, "error")["code"] == "INVALID_OP"
    # Still usable afterwards.
    socket.send_json({"type": "heartbeat"})
    socket.send_json({"type": "join", "doc": "new", "document": DOCUMENT})
    assert drain_until(socket, "snapshot")["rev"] == 0
    socket.close()
