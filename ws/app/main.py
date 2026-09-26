import asyncio
import json
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, status

from . import config, db
from .auth import AuthError, decode_token


@asynccontextmanager
async def lifespan(app: FastAPI):
    await db.connect()
    yield
    await db.disconnect()


# No docs/OpenAPI: this service only speaks websockets to the frontend.
app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)


@app.get("/health", include_in_schema=False)
async def health() -> dict:
    async with db.pool().acquire() as conn:
        await conn.fetchval("SELECT 1")
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

    user_id = claims["sub"]
    await websocket.send_json({"type": "ready", "user": user_id})

    try:
        while True:
            raw = await websocket.receive_text()
            if len(raw.encode()) > config.MAX_MESSAGE_BYTES:
                await websocket.close(code=status.WS_1009_MESSAGE_TOO_BIG)
                return
            # Placeholder handler: replace with your own message routing.
            await websocket.send_json({"type": "echo", "user": user_id, "data": raw})
    except WebSocketDisconnect:
        pass
