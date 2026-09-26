"""Browser-local gameplay API. Engine objects stay on the main thread."""
import asyncio
import inspect
import json
import math
import traceback
from types import SimpleNamespace
import bark_bridge


def _vector(x, y, z):
    values = [float(x), float(y), float(z)]
    if not all(math.isfinite(v) for v in values):
        raise ValueError("Coordinates must be finite numbers")
    return dict(zip(("x", "y", "z"), values))


def _report(error):
    frames = traceback.extract_tb(error.__traceback__)
    lines = [f.lineno for f in frames if f.filename == "script.py"]
    line = getattr(error, "lineno", None) if isinstance(error, SyntaxError) else (lines[-1] if lines else None)
    bark_bridge.report_error(json.dumps({"message": str(error), "line": line, "traceback": "".join(traceback.format_exception(error))}))


class Entity:
    def __init__(self, entity_id):
        if not isinstance(entity_id, str) or not entity_id:
            raise ValueError("Entity ID must be a nonempty string")
        self.id = entity_id

    async def _call(self, op, **kwargs):
        return await game._call(op, id=self.id, **kwargs)

    async def move(self, x, y, z, space="world"):
        if space not in ("world", "local"):
            raise ValueError("Move space must be world or local")
        await self._call("move", vector=_vector(x, y, z), space=space)

    async def move_forward(self, distance):
        await self.move(0, 0, distance, space="local")

    async def turn(self, degrees):
        if not math.isfinite(float(degrees)):
            raise ValueError("Turn angle must be finite")
        await self._call("turn", degrees=float(degrees))

    async def set_velocity(self, x, y, z):
        vector = {axis: None if value is None else float(value) for axis, value in zip(("x", "y", "z"), (x, y, z))}
        if any(value is not None and not math.isfinite(value) for value in vector.values()):
            raise ValueError("Velocity must contain finite numbers or None to preserve an axis")
        await self._call("set_velocity", vector=vector)

    async def apply_impulse(self, x, y, z):
        await self._call("apply_impulse", vector=_vector(x, y, z))

    async def destroy(self):
        return await self._call("destroy")

    async def position(self):
        return SimpleNamespace(**await self._call("position"))

    async def velocity(self):
        return SimpleNamespace(**await self._call("velocity"))

    async def grounded(self):
        return await self._call("grounded")


class Game:
    def __init__(self):
        self._handlers = []
        self._timers = []
        self._queued = 0
        self._started = False
        self._gate = asyncio.Event()
        self.elapsed = 0.0
        self.tick = 0
        self.delta = 0.0

    def entity(self, entity_id):
        return Entity(entity_id)

    async def _call(self, op, **kwargs):
        if not self._started:
            raise RuntimeError("Use gameplay operations inside event handlers")
        await self._gate.wait()
        result = await bark_bridge.request_json(json.dumps({"op": op, **kwargs}))
        await self._gate.wait()
        return json.loads(result)

    async def find(self, tag):
        return [Entity(entity_id) for entity_id in await self._call("find", tag=tag)]

    async def input(self, action):
        return SimpleNamespace(**await self._call("input", action=action))

    async def spawn(self, prefab_id, x=0, y=0, z=0):
        return Entity(await self._call("spawn", prefab=prefab_id, position=_vector(x, y, z)))

    async def wait(self, seconds):
        seconds = float(seconds)
        if not math.isfinite(seconds) or seconds < 0:
            raise ValueError("Wait duration must be finite and nonnegative")
        if not self._started:
            raise RuntimeError("Use waits inside event handlers")
        await self._gate.wait()
        future = asyncio.get_running_loop().create_future()
        self._timers.append((self.elapsed + seconds, self.tick + 1, future))
        await future
        await self._gate.wait()

    async def next_frame(self):
        await self.wait(0)

    def _register(self, kind, key=None):
        def decorate(fn):
            if not inspect.iscoroutinefunction(fn):
                raise TypeError("Bark event handlers must use async def")
            self._handlers.append((kind, key, fn, asyncio.Queue()))
            return fn
        return decorate

    def on_start(self, fn):
        return self._register("start")(fn)

    def on_input(self, action):
        return self._register("input", action)

    def on_touch(self, entity_id):
        return self._register("touch", entity_id)

    def on_interact(self, entity_id):
        return self._register("interact", entity_id)

    async def _run(self, fn, queue):
        try:
            while True:
                args = await queue.get()
                self._queued -= 1
                await self._gate.wait()
                await fn(*args)
        except asyncio.CancelledError:
            raise
        except BaseException as error:
            _report(error)

    def _event(self, payload):
        event = json.loads(payload)
        if event["type"] == "start":
            self._started = True
            self._gate.set()
            for _, _, fn, queue in self._handlers:
                asyncio.create_task(self._run(fn, queue))
        for kind, key, _, queue in self._handlers:
            if event["type"] != kind:
                continue
            if kind == "input":
                if event["action"] != key:
                    continue
                args = (SimpleNamespace(**event["state"]),)
            elif kind == "touch":
                if event["entityId"] != key:
                    continue
                args = (event["otherId"],)
            elif kind == "interact":
                if event["entityId"] != key:
                    continue
                args = (event.get("actorId"),)
            else:
                args = ()
            if self._queued >= 256:
                raise RuntimeError("Script event queue overflow. Simplify handlers or add waits.")
            self._queued += 1
            queue.put_nowait(args)

    def _tick(self, elapsed, tick, delta):
        if not self._gate.is_set():
            return
        self.elapsed, self.tick, self.delta = elapsed, tick, delta
        remaining = []
        for target, target_tick, future in self._timers:
            if future.done():
                continue
            if elapsed + 1e-9 >= target and tick >= target_tick:
                future.set_result(None)
            else:
                remaining.append((target, target_tick, future))
        self._timers = remaining

    def _pause(self):
        self._gate.clear()

    def _resume(self):
        self._gate.set()


game = Game()
