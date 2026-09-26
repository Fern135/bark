import asyncio
import json
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, status

from . import config, db
from .auth import AuthError, decode_token
from .collab import bus, protocol, rooms, store

log = logging.getLogger("bark.ws")


@asynccontextmanager
async def lifespan(app: FastAPI):
    await db.connect()
    if config.AUTO_MIGRATE:
        await store.ensure_schema()
    await bus.connect()
    yield
    await rooms.shutdown()
    await bus.disconnect()
    await db.disconnect()


# No docs/OpenAPI: this service only speaks websockets to the frontend.
app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)


@app.get("/health", include_in_schema=False)
async def health() -> dict:
    async with db.pool().acquire() as conn:
        await conn.fetchval("SELECT 1")
    if not await bus.bus().healthy():
        return {"status": "degraded", "bus": "unreachable"}
    return {"status": "ok"}


async def _authenticate(websocket: WebSocket) -> dict:
    """Accept a JWT from the HttpOnly cookie, or from a first `{"type": "auth", "token": ...}` message."""
    token = websocket.cookies.get(config.JWT_ACCESS_COOKIE)
    if not token:
        raw = await asyncio.wait_for(websocket.receive_text(), timeout=config.AUTH_TIMEOUT)
        message = json.loads(raw)
        if message.get("type") != "auth" or not isinstance(message.get("token"), str):
            raise AuthError("Expected auth message")
        token = message["token"]
    return decode_token(token)


@app.websocket("/ws/")
async def socket(websocket: WebSocket) -> None:
    origin = websocket.headers.get("origin")
    if origin not in config.ALLOWED_ORIGINS:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    await websocket.accept()
    try:
        claims = await _authenticate(websocket)
    except (AuthError, asyncio.TimeoutError, ValueError):
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    # Identity comes from the token and nowhere else; a user id in a client frame is ignored.
    conn = rooms.Connection(websocket, claims["sub"])
    conn.start()
    conn.send(protocol.ready(conn.user_id))

    try:
        while True:
            raw = await websocket.receive_text()
            if len(raw.encode()) > config.MAX_MESSAGE_BYTES:
                await websocket.close(code=status.WS_1009_MESSAGE_TOO_BIG)
                return
            try:
                message = protocol.parse_client_message(json.loads(raw))
            except (protocol.ProtocolError, ValueError) as exc:
                code = getattr(exc, "code", "INVALID_OP")
                conn.send(protocol.error(code, str(getattr(exc, "message", "Malformed frame."))))
                continue
            try:
                await rooms.handle(conn, message)
            except Exception:
                # One bad frame must not take the socket down with it.
                log.exception("collab: handler failed for user %s", conn.user_id)
                conn.send(protocol.error("INVALID_OP", "That request could not be handled."))
            if conn.overflowed:
                # The client stopped reading. Dropping it is the only way to protect the room.
                log.warning("collab: send queue overflow for user %s; closing", conn.user_id)
                await websocket.close(code=status.WS_1011_INTERNAL_ERROR)
                return
    except WebSocketDisconnect:
        pass
    finally:
        await rooms.leave(conn)
        await conn.stop()
