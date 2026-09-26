import test from "node:test";
import assert from "node:assert/strict";
import type { GameRuntime, JsonValue } from "@bark/engine";
import { createEngineAdapter } from "../src/engine";

function fixture() {
  const values = new Map<string, JsonValue>();
  const directions: unknown[] = [];
  const updates = new Set<
    (clock: { elapsed: number; tick: number; delta: number }) => void
  >();
  let focused = true;
  const player = {
    id: "player",
    character: {},
    transform: { rotation: { x: 0, y: 0, z: 0, w: 1 } },
    worldTransform: { rotation: { x: 0, y: 0, z: 0, w: 1 } },
  };
  const runtime = {
    state: "running",
    clock: { elapsed: 0, tick: 0, delta: 1 / 60 },
    world: {
      get: (id: string) => {
        if (id !== "player") throw new Error("Missing entity");
        return player;
      },
      list: () => [player],
      destroy: () => true,
    },
    characters: {
      move: (_: string, direction: unknown) => directions.push(direction),
      jump: () => true,
      teleport: () => {},
      respawn: () => {},
      setSpawn: () => {},
    },
    properties: {
      get: (_: string | null, key: string) => values.get(key),
      set: (_: string | null, key: string, value: JsonValue) => {
        values.set(key, value);
      },
      list: () => Object.fromEntries(values),
      remove: (_: string | null, key: string) => values.delete(key),
    },
    pause: () => {
      (runtime as { state: string }).state = "paused";
    },
    resume: () => {
      (runtime as { state: string }).state = "running";
    },
    stop: () => {
      (runtime as { state: string }).state = "editing";
    },
    onUpdate: (fn: typeof updates extends Set<infer T> ? T : never) => {
      updates.add(fn);
      return () => {
        updates.delete(fn);
      };
    },
  } as unknown as GameRuntime;
  const adapter = createEngineAdapter(runtime, { hasFocus: () => focused });
  const step = () => updates.forEach((fn) => fn(runtime.clock));
  return {
    adapter,
    runtime,
    directions,
    step,
    blur: () => {
      focused = false;
    },
    focus: () => {
      focused = true;
    },
  };
}

test("walk is latched for every update and focus loss rejects late movement", () => {
  const { adapter, directions, step, blur, focus } = fixture();
  const off = adapter.onUpdate(() => {});
  adapter.execute({ op: "walk", id: "player", vector: { x: 1, y: 0, z: 0 } });
  step();
  step();
  step();
  assert.equal(directions.length, 3);
  blur();
  step();
  adapter.execute({ op: "walk", id: "player", vector: { x: 1, y: 0, z: 0 } });
  focus();
  step();
  assert.equal(directions.length, 3);
  off();
});

test("pause, teleport, respawn, destruction and explicit clear release movement", () => {
  for (const action of [
    "pause",
    "teleport",
    "respawn",
    "destroy",
    "clear",
  ] as const) {
    const { adapter, directions, step } = fixture();
    adapter.onUpdate(() => {});
    adapter.execute({ op: "walk", id: "player", vector: { x: 1, y: 0, z: 0 } });
    step();
    if (action === "pause") {
      adapter.pause();
      adapter.resume();
    } else if (action === "clear") adapter.clearMovement?.();
    else if (action === "teleport")
      adapter.execute({
        op: action,
        id: "player",
        vector: { x: 0, y: 0, z: 0 },
      });
    else adapter.execute({ op: action, id: "player" });
    step();
    assert.equal(directions.length, 1, action);
  }
});

test("properties preserve null and missing and change atomically with useful failures", () => {
  const { adapter } = fixture();
  const p = (
    action: "get" | "has" | "set" | "change" | "remove" | "list",
    key = "score",
    value?: JsonValue,
  ) => adapter.execute({ op: "property", action, id: null, key, value });
  assert.deepEqual(p("get"), { present: false, value: null });
  p("set", "score", null);
  assert.deepEqual(p("get"), { present: true, value: null });
  assert.throws(() => p("change", "score", 1), /initialize/);
  p("set", "score", 0);
  assert.equal(p("change", "score", 2), 2);
  assert.equal(p("change", "score", 3), 5);
  assert.throws(() => p("change", "score", Infinity), /finite/);
  assert.deepEqual(p("list"), { score: 5 });
  assert.equal(p("remove"), true);
  assert.equal(p("has"), false);
  assert.throws(
    () => adapter.execute({ op: "jump", id: "missing" }),
    /Missing/,
  );
});
