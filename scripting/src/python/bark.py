"""Browser-local gameplay API. Engine objects stay on the main thread."""
import asyncio
import inspect
import json
import math
import traceback
import sys
import time
from collections import deque
from itertools import islice
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


def _json(value):
    return json.dumps(value, allow_nan=False)


def _name(value):
    if not isinstance(value, str) or not value.strip():
        raise ValueError("Name must be a nonempty string")
    return value


class Properties:
    def __init__(self, entity_id=None):
        self.id = entity_id

    async def _call(self, action, key="", **kwargs):
        return await game._call("property", id=self.id, action=action, key=key, **kwargs)

    async def get(self, key, default=None):
        result = await self._call("get", key)
        return result["value"] if result["present"] else default

    async def has(self, key):
        return await self._call("has", key)

    async def set(self, key, value):
        await self._call("set", key, value=value)

    async def change(self, key, amount):
        return await self._call("change", key, value=amount)

    async def remove(self, key):
        return await self._call("remove", key)

    async def list(self):
        return await self._call("list")


class Entity:
    def __init__(self, entity_id):
        if not isinstance(entity_id, str) or not entity_id:
            raise ValueError("Entity ID must be a nonempty string")
        self.id = entity_id
        self.properties = Properties(entity_id)

    async def walk(self, x, z):
        await self._call("walk", vector=_vector(x, 0, z))

    async def jump(self):
        return await self._call("jump")

    async def teleport(self, x, y, z):
        await self._call("teleport", vector=_vector(x, y, z))

    async def set_spawn(self, x, y, z):
        await self._call("set_spawn", vector=_vector(x, y, z))

    async def respawn(self):
        await self._call("respawn")

    async def glide_to(self, x, y, z, seconds, easing="linear"):
        return await self._call("glide_to", vector=_vector(x, y, z), seconds=float(seconds), easing=easing)

    async def rotate_to(self, y_degrees, seconds, easing="linear"):
        return await self._call("rotate_to", degrees=float(y_degrees), seconds=float(seconds), easing=easing)

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
        self.properties = Properties()
        self._named_timers = {}
        self._inspection = False
        self._last_snapshot = 0
        self._activity = deque(maxlen=200)
        self._location = None
        self._scope = {}

    async def target(self, actor_id):
        result = await self._call("target", actor=actor_id)
        return Entity(result) if result is not None else None

    async def interact(self, actor_id, target_id=None):
        return await self._call("interact", actor=actor_id, **({"target": target_id} if target_id is not None else {}))

    async def set_hud(self, key, label, value):
        await self._call("set_hud", key=key, label=label, value=value)

    async def remove_hud(self, key):
        await self._call("remove_hud", key=key)

    async def notify(self, text, seconds=3):
        return await self._call("notify", text=str(text), seconds=float(seconds))

    async def broadcast(self, name, payload=None):
        await self._cooperate()
        self._event(_json({"type": "message", "name": _name(name), "payload": payload}))

    async def start_timer(self, name, seconds, repeat=False):
        await self._cooperate()
        _name(name)
        seconds = float(seconds)
        if not math.isfinite(seconds) or seconds <= 0:
            raise ValueError("Timer duration must be finite and positive")
        if name not in self._named_timers and len(self._named_timers) >= 256:
            raise RuntimeError("Timer limit exceeded (256)")
        self._discard_timer(name)
        self._named_timers[name] = (self.elapsed + seconds, seconds, bool(repeat))

    async def cancel_timer(self, name):
        await self._cooperate()
        self._named_timers.pop(name, None)
        self._discard_timer(name)

    def _discard_timer(self, name):
        for kind, key, _, queue in self._handlers:
            if kind == "timer" and key == name:
                while not queue.empty():
                    queue.get_nowait()
                    self._queued -= 1

    async def _cooperate(self):
        if not self._started:
            raise RuntimeError("Use gameplay operations inside event handlers")
        await self._gate.wait()
        await asyncio.sleep(0)
        await self._gate.wait()

    def entity(self, entity_id):
        return Entity(entity_id)

    async def _call(self, op, **kwargs):
        if not self._started:
            raise RuntimeError("Use gameplay operations inside event handlers")
        await self._gate.wait()
        result = await bark_bridge.request_json(_json({"op": op, **kwargs}))
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

    def on_touch_end(self, entity_id):
        return self._register("touch_end", entity_id)

    def on_respawn(self, entity_id):
        return self._register("respawn", entity_id)

    def on_message(self, name):
        return self._register("message", _name(name))

    def on_timer(self, name):
        return self._register("timer", _name(name))

    async def _run(self, fn, queue):
        try:
            while True:
                args, event = await queue.get()
                self._queued -= 1
                await self._gate.wait()
                self._record(fn, event, "start")
                await fn(*args)
                self._record(fn, event, "complete")
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
            elif kind in ("touch", "touch_end"):
                if event["entityId"] != key:
                    continue
                args = (event["otherId"],)
            elif kind == "interact":
                if event["entityId"] != key:
                    continue
                args = (event.get("actorId"),)
            elif kind == "respawn":
                if event["entityId"] != key:
                    continue
                args = ()
            elif kind in ("message", "timer"):
                if event["name"] != key:
                    continue
                if kind == "timer" and not queue.empty():
                    continue
                args = (json.loads(_json(event.get("payload"))),) if kind == "message" else ()
            else:
                args = ()
            if self._queued >= 256:
                raise RuntimeError("Script event queue overflow. Simplify handlers or add waits.")
            self._queued += 1
            queue.put_nowait((args, event["type"] + ":" + str(key or "")))

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
        for name, (target, seconds, repeat) in list(self._named_timers.items()):
            if elapsed + 1e-9 >= target:
                if repeat:
                    self._named_timers[name] = (elapsed + seconds, seconds, repeat)
                else:
                    del self._named_timers[name]
                self._event(_json({"type": "timer", "name": name}))
        self._snapshot()

    def _record(self, fn, event, phase):
        if self._inspection:
            self._activity.append({"handler": fn.__name__, "event": event, "phase": phase, "time": self.elapsed})

    def _inspect(self, enabled):
        self._inspection = bool(enabled)
        sys.settrace(self._trace if enabled else None)

    def _trace(self, frame, event, arg):
        if frame.f_code.co_filename != "script.py":
            return None
        if event == "line":
            self._location = frame.f_lineno
            self._scope = frame.f_locals.copy()
            self._snapshot()
        return self._trace

    def _mark(self, line):
        if self._inspection:
            frame = sys._getframe(1)
            self._location, self._scope = line, frame.f_locals.copy()
            self._snapshot()

    def _preview(self, value, depth=0):
        if value is None or type(value) in (bool, int):
            return value if type(value) is not int or abs(value) < 10**100 else "<large integer>"
        if type(value) is float:
            return value if math.isfinite(value) else "<nonfinite number>"
        if type(value) is str:
            return value[:200]
        if type(value) is Entity:
            return {"entity": value.id}
        if depth >= 3:
            return "<depth limit>"
        if type(value) in (list, tuple):
            return [self._preview(v, depth + 1) for v in value[:20]] + (["<truncated>"] if len(value) > 20 else [])
        if type(value) is dict:
            return {str(k)[:80]: self._preview(v, depth + 1) for k, v in islice(value.items(), 20) if type(k) in (str, int, bool)}
        return "<unsupported value>"

    def _snapshot(self):
        now = time.monotonic()
        if not self._inspection or now - self._last_snapshot < 0.1:
            return
        self._last_snapshot = now
        def values(scope):
            return {k: self._preview(v) for k, v in islice(scope.items(), 100) if not k.startswith("_") and k != "game" and not inspect.isroutine(v)}
        bark_bridge.inspect_json(_json({"line": self._location, "globals": values(getattr(self, "_globals", {})), "locals": values(self._scope), "activity": list(self._activity)}))

    def _pause(self):
        self._gate.clear()

    def _resume(self):
        self._gate.set()


game = Game()
