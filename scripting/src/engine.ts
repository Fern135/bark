import { degreesFromQuaternion, quaternionFromDegrees } from "@bark/engine";
import type { GameRuntime } from "@bark/engine";
import type { EngineAdapter, Operation } from "./types.js";

export function createEngineAdapter(runtime: GameRuntime): EngineAdapter {
  return {
    get state() {
      return runtime.state;
    },
    get clock() {
      return runtime.clock;
    },
    play: () => runtime.play(),
    pause: () => runtime.pause(),
    resume: () => runtime.resume(),
    stop: () => runtime.stop(),
    execute(operation: Operation) {
      const o = operation;
      switch (o.op) {
        case "move":
          return runtime.transforms.move(o.id, o.vector, o.space);
        case "turn": {
          if (!Number.isFinite(o.degrees)) throw new Error("Turn angle must be finite.");
          const rotation = degreesFromQuaternion(runtime.world.get(o.id).transform.rotation);
          return runtime.transforms.set(o.id, {
            rotation: quaternionFromDegrees({ ...rotation, y: rotation.y + o.degrees }),
          });
        }
        case "set_velocity": {
          const current = runtime.physics.velocity(o.id);
          return runtime.physics.setVelocity(o.id, {
            x: o.vector.x ?? current.x,
            y: o.vector.y ?? current.y,
            z: o.vector.z ?? current.z,
          });
        }
        case "apply_impulse":
          return runtime.physics.applyImpulse(o.id, o.vector);
        case "destroy":
          return runtime.world.destroy(o.id);
        case "position":
          return runtime.world.get(o.id).worldTransform.position;
        case "velocity":
          return runtime.physics.velocity(o.id);
        case "grounded":
          return runtime.physics.grounded(o.id);
        case "find":
          return runtime.world.list({ tag: o.tag }).map((e) => e.id);
        case "input":
          return runtime.input.action(o.action);
        case "spawn":
          return runtime.world.spawnPrefab(o.prefab, o.position);
        default:
          throw new Error("Unknown scripting operation.");
      }
    },
    onUpdate: (listener) => runtime.onUpdate(listener),
    onState: (listener) => runtime.on("state", (e) => listener(e.state)),
    onEvent(listener) {
      const options = { scope: "session" as const };
      const held = new Map<string, boolean>();
      const touch = (a: string, b: string) => {
        listener({ type: "touch", entityId: a, otherId: b });
        listener({ type: "touch", entityId: b, otherId: a });
      };
      const subscriptions = [
        runtime.onUpdate(() => {
          for (const action of Object.keys(runtime.input.bindings())) {
            const state = runtime.input.action(action),
              wasHeld = held.get(action) ?? false;
            if (state.pressed || state.released || state.held !== wasHeld)
              listener({
                type: "input",
                action,
                state: { ...state, released: state.released || (wasHeld && !state.held) },
              });
            held.set(action, state.held);
          }
        }),
        runtime.on(
          "collision",
          (e) => {
            if (e.phase === "start") touch(e.a, e.b);
          },
          options,
        ),
        runtime.on(
          "trigger",
          (e) => {
            if (e.phase === "enter") touch(e.a, e.b);
          },
          options,
        ),
        runtime.on("interaction", (e) => listener({ type: "interact", ...e }), options),
      ];
      return () => subscriptions.forEach((unsubscribe) => unsubscribe());
    },
  };
}
