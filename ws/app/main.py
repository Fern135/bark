import asyncio
import json
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, status
from fastapi.responses import JSONResponse

from . import config
from .auth import AuthError, decode_token
from .collab import bus, protocol
from .collab import workspaces as rooms
from .collab.rooms import Connection
from .collab.workspaces import OpError
import time

log = logging.getLogger("bark.ws")


@asynccontextmanager
async def lifespan(app: FastAPI):
    await bus.connect()
    yield
    await rooms.shutdown()
    await bus.disconnect()



# No docs/OpenAPI: this service only speaks websockets to the frontend.
app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)


@app.get("/health", include_in_schema=False)
async def health():
    from asgiref.sync import sync_to_async
    from django.db import connection
    def check():
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
    try:
        await sync_to_async(check)()
        if not await bus.bus().healthy():
            return JSONResponse({"status": "unavailable"}, status_code=503)
    except Exception:
        return JSONResponse({"status": "unavailable"}, status_code=503)
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
    conn = Connection(websocket, claims["sub"])
    conn.start()
    conn.send({"type": "ready", "protocol": 2, "user": conn.user_id, "conn": conn.id})

    try:
        while True:
            if time.time() >= claims["exp"]:
                await websocket.close(code=1008)
                return
            raw = await asyncio.wait_for(websocket.receive_text(), timeout=max(0.01, claims["exp"] - time.time()))
            if len(raw.encode()) > config.MAX_MESSAGE_BYTES:
                await websocket.close(code=status.WS_1009_MESSAGE_TOO_BIG)
                return
            try:
                message = json.loads(raw)
                if not isinstance(message, dict):
                    raise ValueError("Expected object")
                protocol.check_depth(message)
            except (protocol.ProtocolError, ValueError) as exc:
                code = getattr(exc, "code", "INVALID_OP")
                conn.send(protocol.error(code, str(getattr(exc, "message", "Malformed frame."))))
                continue
            try:
                await rooms.handle(conn, message)
            except (OpError, ValueError, KeyError) as exc:
                conn.send({"type": "error", "code": getattr(exc, "code", "INVALID_OP"), "message": str(exc), "nonce": message.get("nonce")})
            except Exception:
                # One bad frame must not take the socket down with it.
                log.exception("collab: handler failed for user %s", conn.user_id)
                conn.send(protocol.error("INVALID_OP", "That request could not be handled."))
            if conn.overflowed:
                # The client stopped reading. Dropping it is the only way to protect the room.
                log.warning("collab: send queue overflow for user %s; closing", conn.user_id)
                await websocket.close(code=status.WS_1011_INTERNAL_ERROR)
                return
    except asyncio.TimeoutError:
        await websocket.close(code=1008)
    except WebSocketDisconnect:
        pass
    finally:
        await rooms.leave(conn)
        await conn.stop()
