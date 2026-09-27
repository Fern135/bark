import { degreesFromQuaternion, quaternionFromDegrees } from "@bark/engine";
import type { GameRuntime } from "@bark/engine";
import type { EngineAdapter, Operation } from "./types.js";

export function createEngineAdapter(
  runtime: GameRuntime,
  options: { hasFocus?: () => boolean } = {},
): EngineAdapter {
  const walking = new Map<string, { x: number; y: number; z: number }>();
  const clearMovement = () => walking.clear();
  const character = (id: string) => {
    if (!runtime.world.get(id).character)
      throw new Error(
        `Entity '${id}' needs a character component (dynamic upright capsule).`,
      );
    return runtime.characters;
  };
  return {
    clearMovement,
    get state() {
      return runtime.state;
    },
    get clock() {
      return runtime.clock;
    },
    play: () => runtime.play(),
    pause: () => {
      clearMovement();
      runtime.pause();
    },
    resume: () => runtime.resume(),
    stop: () => {
      clearMovement();
      runtime.stop();
    },
    execute(operation: Operation) {
      const o = operation;
      switch (o.op) {
        case "walk":
          character(o.id);
          if (![o.vector.x, o.vector.z].every(Number.isFinite))
            throw new Error("Walk direction must be finite.");
          if (options.hasFocus?.() !== false) walking.set(o.id, o.vector);
          else walking.delete(o.id);
          return;
        case "jump":
          return character(o.id).jump(o.id);
        case "teleport":
          walking.delete(o.id);
          return character(o.id).teleport(o.id, { position: o.vector });
        case "set_spawn":
          return character(o.id).setSpawn(o.id, {
            position: o.vector,
            rotation: runtime.world.get(o.id).worldTransform.rotation,
          });
        case "respawn":
          walking.delete(o.id);
          return character(o.id).respawn(o.id);
        case "target":
          return runtime.interactions.target(o.actor);
        case "interact":
          return runtime.interactions.interact(o.actor, o.target);
        case "glide_to":
          return runtime.motion.glideTo(o.id, o.vector, o.seconds, o.easing)
            .done;
        case "rotate_to": {
          const angles = degreesFromQuaternion(
            runtime.world.get(o.id).transform.rotation,
          );
          return runtime.motion.rotateTo(
            o.id,
            quaternionFromDegrees({ ...angles, y: o.degrees }),
            o.seconds,
            o.easing,
          ).done;
        }
        case "property": {
          const properties = runtime.properties;
          if (o.action === "list") return properties.list(o.id);
          const current = properties.get(o.id, o.key);
          switch (o.action) {
            case "get":
              return { present: current !== undefined, value: current ?? null };
            case "has":
              return current !== undefined;
            case "set":
              if (o.value === undefined)
                throw new Error("Property value must be JSON-compatible.");
              return properties.set(o.id, o.key, o.value);
            case "remove":
              return properties.remove(o.id, o.key);
            case "change": {
              if (
                typeof current !== "number" ||
                typeof o.value !== "number" ||
                !Number.isFinite(current + o.value)
              )
                throw new Error(
                  `Property '${o.key}' and change amount must be finite numbers; initialize it first.`,
                );
              properties.set(o.id, o.key, current + o.value);
              return current + o.value;
            }
          }
          break;
        }
        case "set_hud":
          return runtime.feedback.setHud(o.key, o.label, o.value);
        case "remove_hud":
          return runtime.feedback.removeHud(o.key);
        case "notify":
          return runtime.feedback.notify(o.text, o.seconds);
        case "move":
          return runtime.transforms.move(o.id, o.vector, o.space);
        case "turn": {
          if (!Number.isFinite(o.degrees))
            throw new Error("Turn angle must be finite.");
          const rotation = degreesFromQuaternion(
            runtime.world.get(o.id).transform.rotation,
          );
          return runtime.transforms.set(o.id, {
            rotation: quaternionFromDegrees({
              ...rotation,
              y: rotation.y + o.degrees,
            }),
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
          walking.delete(o.id);
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
    onUpdate: (listener) =>
      runtime.onUpdate((clock) => {
        listener(clock);
        if (runtime.state !== "running" || options.hasFocus?.() === false) {
          clearMovement();
          return;
        }
        const existing = walking.size
          ? new Set(runtime.world.list().map((e) => e.id))
          : new Set<string>();
        for (const [id, direction] of walking) {
          if (existing.has(id)) runtime.characters.move(id, direction);
          else walking.delete(id);
        }
      }),
    onState: (listener) => runtime.on("state", (e) => listener(e.state)),
    onEvent(listener) {
      const options = { scope: "session" as const };
      const held = new Map<string, boolean>();
      const touch = (type: "touch" | "touch_end", a: string, b: string) => {
        listener({ type, entityId: a, otherId: b });
        listener({ type, entityId: b, otherId: a });
      };
      const subscriptions = [
        runtime.on("entity", (e) => { if (e.action === "destroyed") listener({ type: "destroy", entityId: e.entityId }); }, options),
        runtime.onUpdate(() => {
          for (const action of Object.keys(runtime.input.bindings())) {
            const state = runtime.input.action(action),
              wasHeld = held.get(action) ?? false;
            if (state.pressed || state.released || state.held !== wasHeld)
              listener({
                type: "input",
                action,
                state: {
                  ...state,
                  released: state.released || (wasHeld && !state.held),
                },
              });
            held.set(action, state.held);
          }
        }),
        runtime.on(
          "collision",
          (e) => {
            touch(e.phase === "start" ? "touch" : "touch_end", e.a, e.b);
          },
          options,
        ),
        runtime.on(
          "trigger",
          (e) => {
            touch(e.phase === "enter" ? "touch" : "touch_end", e.a, e.b);
          },
          options,
        ),
        runtime.on(
          "interaction",
          (e) => listener({ type: "interact", ...e }),
          options,
        ),
        runtime.on(
          "respawn",
          (e) => {
            walking.delete(e.entityId);
            listener({ type: "respawn", entityId: e.entityId });
          },
          options,
        ),
      ];
      return () => subscriptions.forEach((unsubscribe) => unsubscribe());
    },
  };
}
