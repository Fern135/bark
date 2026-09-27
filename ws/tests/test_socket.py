"""Protocol v3 against a disposable PostgreSQL database (WS_TEST_DSN).

Run the browser collaboration suite for gateway/cookie and multi-worker coverage.
"""
import os
import uuid
from urllib.parse import urlparse
import pytest

pytestmark = pytest.mark.skipif(not os.environ.get("WS_TEST_DSN"), reason="set WS_TEST_DSN to a disposable PostgreSQL database")

@pytest.fixture
def workspace():
    parsed = urlparse(os.environ["WS_TEST_DSN"])
    os.environ.update(POSTGRES_HOST=parsed.hostname or "localhost", POSTGRES_PORT=str(parsed.port or 5432), POSTGRES_DB=parsed.path.lstrip("/"), POSTGRES_USER=parsed.username or "bark", POSTGRES_PASSWORD=parsed.password or "bark", REDIS_URL="")
    from app.collab import canvas_store
    from django.core.management import call_command
    from authenticator.models import User
    from authenticator.tokens import create_access_token
    from canvas.models import Game
    from canvas.defaults import new_game_document
    from canvas.document import save_document
    call_command("migrate", verbosity=0)
    owner = User.objects.create(user_id=str(uuid.uuid4()), username="Socket owner", password="unused", email="socket@example.test")
    game = Game.objects.create(owner=owner, name="Socket world", collaboration=True)
    save_document(game, new_game_document("Socket world"))
    yield game, create_access_token(owner)
    owner.delete()

@pytest.fixture
def client(workspace):
    from fastapi.testclient import TestClient
    from app.main import app
    with TestClient(app) as client:
        client.cookies.set("access_token", workspace[1])
        yield client

def receive(ws, kind):
    for _ in range(20):
        frame = ws.receive_json()
        if frame["type"] == kind:
            return frame
    raise AssertionError(f"Did not receive {kind}")

def test_join_and_durable_commit(client, workspace):
    game, _ = workspace
    with client.websocket_connect("/ws/", headers={"origin":"http://localhost:8080"}) as ws:
        assert receive(ws, "ready")["protocol"] == 3
        ws.send_json({"type":"join", "protocol":3, "doc":str(game.id)})
        snapshot = receive(ws, "snapshot"); receive(ws, "joined")
        ws.send_json({"type":"lock", "resources":["section:properties"], "nonce":1})
        receive(ws, "locked")
        commit = {"type":"commit", "base":snapshot["rev"], "commitId":str(uuid.uuid4()), "ops":[{"op":"set", "resource":"section:properties", "before":snapshot["document"]["project"]["properties"], "value":{"score":42}}]}
        ws.send_json(commit); first = receive(ws, "ack")
        assert receive(ws, "patch")["rev"] == first["rev"]
        ws.send_json(commit); assert receive(ws, "ack")["rev"] == first["rev"]
    game.refresh_from_db(); assert game.properties == {"score":42}

def test_no_legacy_room_creation(client):
    with client.websocket_connect("/ws/", headers={"origin":"http://localhost:8080"}) as ws:
        receive(ws,"ready")
        ws.send_json({"type":"join", "protocol":3, "doc":"new"})
        assert receive(ws,"error")["code"] == "INVALID_OP"

def test_uuid_does_not_grant_access(client):
    with client.websocket_connect("/ws/", headers={"origin":"http://localhost:8080"}) as ws:
        receive(ws,"ready")
        ws.send_json({"type":"join", "protocol":3, "doc":str(uuid.uuid4())})
        assert receive(ws,"error")["code"] == "FORBIDDEN"


def test_concurrent_transactions_serialize_and_rebase_independent_sections(workspace):
    """Independent DB connections exercise the PostgreSQL row lock, not LocalBus."""
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier
    from django.db import close_old_connections
    from canvas import collaboration as service
    from canvas.collaboration_ops import OpError
    game, _ = workspace
    user = game.owner_id
    connections = [str(uuid.uuid4()), str(uuid.uuid4())]
    original = service.snapshot(user, game.id)
    resources = ["section:properties", "section:name"]
    values = [{"shared": True}, "Concurrent name"]
    for connection, resource in zip(connections, resources):
        service.acquire(user, game.id, connection, [resource])
    gate = Barrier(2)
    def write(index):
        close_old_connections()
        try:
            key = resources[index].split(":")[1]
            op = {"op": "set", "resource": resources[index], "before": original["document"]["project"][key], "value": values[index]}
            gate.wait(timeout=5)
            try:
                return service.commit(user, game.id, connections[index], str(uuid.uuid4()), original["rev"], [op])
            except OpError as error:
                assert error.code == "REV_MISMATCH"
                latest = service.snapshot(user, game.id)
                return service.commit(user, game.id, connections[index], str(uuid.uuid4()), latest["rev"], [op])
        finally:
            close_old_connections()
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(write, range(2)))
    assert sorted(result["rev"] for result in results) == [original["rev"] + 1, original["rev"] + 2]
    final = service.snapshot(user, game.id)
    assert final["document"]["project"]["properties"] == values[0]
    assert final["document"]["project"]["name"] == values[1]


def test_connected_session_expires(client, workspace):
    import time
    import jwt
    from app import config
    from starlette.websockets import WebSocketDisconnect
    claims = jwt.decode(workspace[1], config.JWT_SECRET, algorithms=[config.JWT_ALGORITHM], audience=config.JWT_AUDIENCE, issuer=config.JWT_ISSUER)
    claims["exp"] = int(time.time()) + 2
    client.cookies.set("access_token", jwt.encode(claims, config.JWT_SECRET, algorithm=config.JWT_ALGORITHM))
    with client.websocket_connect("/ws/", headers={"origin": "http://localhost:8080"}) as ws:
        receive(ws, "ready")
        with pytest.raises(WebSocketDisconnect) as closed:
            ws.receive_json()
        assert closed.value.code == 1008
