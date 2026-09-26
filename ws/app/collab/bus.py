"""Fan-out bus. Redis pub/sub across uvicorn workers, or an in-process bus for one worker.

Two rules make the ordering easy to reason about:

1. A committing worker never delivers its own commit directly. It publishes, and the
   subscription delivers — on every worker, including itself. One code path, no dedupe.
2. One channel per document, one subscription per document per worker, so Redis preserves
   publish order and every client sees revs in the same sequence.
"""

import asyncio
import json
import logging
from typing import Any, Awaitable, Callable, Protocol

from .. import config

log = logging.getLogger("bark.collab.bus")

Handler = Callable[[dict], Awaitable[None]]


def channel_for(doc_id: str) -> str:
    return f"bark:doc:{doc_id}"


class Bus(Protocol):
    async def start(self) -> None: ...
    async def close(self) -> None: ...
    async def publish(self, channel: str, payload: dict) -> None: ...
    async def subscribe(self, channel: str, handler: Handler) -> None: ...
    async def unsubscribe(self, channel: str) -> None: ...
    async def healthy(self) -> bool: ...


class LocalBus:
    """Single-process bus. Same semantics as Redis for one uvicorn worker, so dev and tests
    need no Redis container — and there is only ever one delivery code path to debug."""

    def __init__(self) -> None:
        self._handlers: dict[str, Handler] = {}

    async def start(self) -> None:
        return None

    async def close(self) -> None:
        self._handlers.clear()

    async def publish(self, channel: str, payload: dict) -> None:
        handler = self._handlers.get(channel)
        if handler is not None:
            # Awaited inline, which preserves publish order exactly as Redis would.
            await handler(payload)

    async def subscribe(self, channel: str, handler: Handler) -> None:
        self._handlers[channel] = handler

    async def unsubscribe(self, channel: str) -> None:
        self._handlers.pop(channel, None)

    async def healthy(self) -> bool:
        return True


class RedisBus:
    def __init__(self, url: str) -> None:
        self._url = url
        self._client: Any = None
        self._pubsub: Any = None
        self._handlers: dict[str, Handler] = {}
        self._reader: asyncio.Task | None = None

    async def start(self) -> None:
        import redis.asyncio as redis  # imported here so LocalBus needs no redis install

        self._client = redis.from_url(self._url, encoding="utf-8", decode_responses=True)
        await self._client.ping()
        self._pubsub = self._client.pubsub(ignore_subscribe_messages=True)
        self._reader = asyncio.create_task(self._read(), name="collab-bus-reader")

    async def close(self) -> None:
        if self._reader is not None:
            self._reader.cancel()
            try:
                await self._reader
            except asyncio.CancelledError:
                pass
            self._reader = None
        if self._pubsub is not None:
            await self._pubsub.aclose()
            self._pubsub = None
        if self._client is not None:
            await self._client.aclose()
            self._client = None
        self._handlers.clear()

    async def _read(self) -> None:
        while True:
            try:
                message = await self._pubsub.get_message(timeout=1.0)
            except asyncio.CancelledError:
                raise
            except Exception:
                log.exception("collab bus read failed; retrying")
                await asyncio.sleep(0.5)
                continue
            if not message:
                continue
            handler = self._handlers.get(message.get("channel", ""))
            if handler is None:
                continue
            try:
                await handler(json.loads(message["data"]))
            except Exception:
                # A bad frame from the bus must never kill the reader for every room.
                log.exception("collab bus handler failed")

    async def publish(self, channel: str, payload: dict) -> None:
        await self._client.publish(channel, json.dumps(payload))

    async def subscribe(self, channel: str, handler: Handler) -> None:
        self._handlers[channel] = handler
        await self._pubsub.subscribe(channel)

    async def unsubscribe(self, channel: str) -> None:
        self._handlers.pop(channel, None)
        if self._pubsub is not None:
            await self._pubsub.unsubscribe(channel)

    async def healthy(self) -> bool:
        try:
            return bool(await self._client.ping())
        except Exception:
            return False


_bus: Bus | None = None


async def connect() -> None:
    global _bus
    _bus = RedisBus(config.REDIS_URL) if config.REDIS_URL else LocalBus()
    await _bus.start()
    log.info("collab bus: %s", type(_bus).__name__)


async def disconnect() -> None:
    global _bus
    if _bus is not None:
        await _bus.close()
        _bus = None


def bus() -> Bus:
    if _bus is None:
        raise RuntimeError("Collaboration bus is not initialised")
    return _bus
