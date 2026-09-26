# Bark engine and gameplay playground

A standalone TypeScript browser runtime on Babylon.js and Havok Physics V2. It owns the world, rendering and simulation; React is used only by the development playground. Everything is contained in `engine/`. It does not call the website, Django, or websocket services.

## Run

Node.js 22.12+ and npm:

```powershell
cd C:\dev\bark\engine
npm ci
npm run dev
```

Open **http://localhost:5173/test/**. Both development and preview servers bind only to the local machine and require their configured ports to be free.

| Command | Purpose |
| --- | --- |
| `npm run dev` | React playground on port 5173, with hot reload |
| `npm run typecheck` | Check engine, playground, and configuration |
| `npm run build` | ESM and declarations in `dist/` |
| `npm test` | Build and run real-Havok tests, including the trusted demo |
| `npm run build:test` | Bundle the playground into `dist-test/` |
| `npm run preview` | Production playground on port 4173 at `/test/` |

Dependencies and build/test outputs are ignored locally; the package lockfile is included. The GLB and texture fixtures are original deterministic assets, regenerated with `node test/fixtures/create-fixtures.mjs`. Vite's bundle-size warning is expected for the Babylon/Havok foundation.

## Try the playground

**Collect & explore** loads a character, three imported coin models, a textured interaction sign, a locked kinematic door, a checkpoint, obstacles, a finish trigger, and an entity hierarchy. **Physics workshop** loads a second project with falling primitives.

1. Select an entity from the list. Use the inspector sections to change identity, tags, local transforms, parent, appearance, collider, or physics. The inspector shows local values; selecting World interprets the entered transform as world coordinates.
2. Press **Play**, then click the viewport to give it keyboard focus. Use **WASD/arrows** to move, **Space** to jump, and **E** to interact while facing a prompted object. Collect three coins, open the door, cross the purple checkpoint, and reach the finish. Falling off the floor respawns at the latest checkpoint.
3. **Pause** keeps the current session. **Resume** continues it. **Stop / restore** restores authored objects, transforms, materials, camera, and settings, and resets the clock. Runtime edits and collected objects are not saved into the project.
4. Try spawning the `totem` prefab, switching worlds, adjusting camera/render settings, and importing/exporting project JSON. Export always saves the authored project. Asset URLs must remain accessible when importing the file elsewhere; JSON is not a general asset archive.
5. **Unmount** / **Mount viewport** exercises cleanup and fresh initialization. A failed initial load can be retried by remounting. Failed later loads preserve the previous project; use Stop to recover it.
6. While editing, choose a **Placement object**, press **Place**, and click a valid surface. Preview green means valid; red means blocked. **R** rotates and **Escape** cancels while the canvas has focus. **Duplicate selection** copies a subtree into placement mode. Dragging still orbits the editor camera without placing an object. Placement tools are disabled during Play.

Keyboard input is ignored while editing inspector fields. Editor-camera orbit/zoom is attached only when that camera is active. The follow camera tracks a configurable world-space offset; it does not perform camera-obstacle avoidance.

## Public API

`src/index.ts` exports the runtime factory, project helpers, error class, rotation conversion helpers, and plain TypeScript contracts. Babylon objects remain internal. The package exports built ESM/declarations from `dist/`; build before consuming `@bark/engine` in another host.

```ts
import { createRuntime, createProject, defineEntity } from "@bark/engine";
import havokWasmUrl from "@babylonjs/havok/lib/esm/HavokPhysics.wasm?url";

const canvas = document.querySelector<HTMLCanvasElement>("#game")!;
const abort = new AbortController();
const runtime = await createRuntime({ canvas, havokWasmUrl, signal: abort.signal });
const project = createProject("My game");
project.entities.push(defineEntity({
  id: "ball",
  name: "Ball",
  tags: ["toy"],
  transform: { position: { x: 0, y: 4, z: 0 } },
  visual: { kind: "sphere", size: { x: 1, y: 1, z: 1 }, color: "#8ED6A3" },
  collider: { shape: "sphere" },
  body: { mass: 2 },
}));
await runtime.load(project, { signal: abort.signal });
// The loaded world is editable, with simulation stopped.
runtime.play();
const unsubscribe = runtime.onUpdate(({ delta }) => {
  // Called before physics, at a fixed 1/60-second interval.
});
runtime.physics.applyImpulse("ball", { x: 2, y: 4, z: 0 });
runtime.on("collision", ({ phase, a, b }) => {
  console.log(phase, a, b);
}, { scope: "session" });

const observer = new ResizeObserver(() => runtime.resize());
observer.observe(canvas);
// Host teardown:
// abort.abort(); observer.disconnect(); unsubscribe(); runtime.dispose();
```

The canvas must have CSS dimensions. The WASM URL example uses Vite's URL import; other hosts supply an equivalent locally served asset URL. Runtime creation and project loading support cancellation. The React host demonstrates cancellation during Strict Mode cleanup.

| Domain | Operations |
| --- | --- |
| Runtime | `load`, `unload`, `play`, `pause`, `resume`, `stop`, `dispose`, `resize` |
| State | `state`, `clock`, `settings`, `exportProject`, `configure` |
| World | `spawn`, `spawnPrefab`, `update`, `get`, `list({ tag, type })`, `children`, `destroy` |
| Transforms | `set`, `move`, `reparent`, `lookAt`, `forward`, `toWorld`, `toLocal` |
| Physics | `velocity`, `setVelocity`, `applyImpulse`, `raycast`, `overlap`, `grounded` |
| Cameras | `get`, `set`, `forward` |
| Input | `action(name)` → pressed/held/released, `pointer()` → normalized canvas coordinates, `bindings()` |
| Assets | `list()`; asset declarations are loaded with the project |
| Characters | `move`, `jump`, `teleport`, `setSpawn`, `respawn`, `get` |
| Interaction | `target(actorId)`, `interact(actorId, targetId?)` |
| Properties | `get`, `list`, `set`, `remove`; use `null` for world properties |
| Motion | `glideTo`, `rotateTo`; cancellable completion handles |
| Feedback | `get`, `setHud`, `removeHud`, `notify`, `dismiss` |
| Placement | `begin`, `configure`, `aim`, `rotate`, `get`, `commit`, `cancel` |
| Commands | `dispatch` typed spawn/update/destroy/move/impulse/velocity/camera/interact commands |
| Events | `on(type, handler, { scope })`, `onUpdate(handler)`; both return unsubscribe functions |

Commands and world edits complete synchronously. Loading completes asynchronously or rejects with `EngineError`. Codes are `INVALID_ARGUMENT`, `NOT_FOUND`, `INVALID_STATE`, `ASSET_LOAD`, `CANCELLED`, `DISPOSED`, `CALLBACK_ERROR`, and `LIMIT_EXCEEDED`. Failed project validation leaves the current world untouched. Callback failures pause execution in the error state and emit an error; use Stop to recover. The `interact` command requires `actorId` and uses the same distance/obstruction checks as `interactions.interact`; it is not a raw event emitter.

## Ownership and lifecycle

Three distinct layers are maintained: the authored `ProjectDocument`, runtime entity/node/body state, and Babylon rendering/asset resources. Editing-mode mutations update authored definitions. Play rebuilds from those definitions; changes during running/paused sessions are temporary. `exportProject()` returns a detached authored snapshot.

States are `empty`, `loading`, `editing`, `running`, `paused`, `error`, and `disposed`. Play requires editing, Pause requires running, and Resume requires paused. Stop cancels loading, clears session callbacks, restores the prior authored world, and returns to editing (or empty). Unload removes the world. Dispose is idempotent and releases renderer, listeners, assets, bodies, and scene resources.

Runtime-scoped event subscriptions persist across worlds until unsubscribed/disposed. Session subscriptions and all fixed-update callbacks are removed by Play reset, Stop, load, or unload. Register gameplay callbacks after Play, as `test/demo.ts` does. Subscribe to lifecycle changes with runtime scope if a host needs to attach a behavior automatically.

One Babylon engine render loop drives a bounded fixed-step accumulator. Simulation order is input sampling → trusted update callbacks → characters/timed motion → Havok step and transform synchronization → queued contacts, motion completions and targeting events → tick event. No physics step runs from React or Babylon scene rendering. At most four ticks catch up per rendered frame; excess wall time is dropped. Paused time is excluded. Physics callbacks only queue events, so handlers can safely destroy or edit entities after the step. Stop or world replacement during delivery invalidates remaining events from that session.

Loading stages a separate scene before replacing the active scene. Superseded/cancelled loads cannot commit; late decoder results are disposed. A failed load retains the previous authored project for Stop recovery. Model and texture resources are cached by type/URL within the active world and reused across Play/Stop and entity instances. Project replacement disposes the previous world's cache; it is not a cross-project persistent cache.

## Project and transform conventions

Version-1 documents contain `name`, `settings`, `entities`, `assets`, `materials`, `prefabs`, `cameras`, and `input`, plus optional world `properties`. Entities optionally contain `properties`, `character`, and `interaction`. Missing dictionaries normalize to `{}` and missing components to `null`; existing version-1 projects remain loadable. Use `createProject` and `defineEntity` for defaults and `validateProject` to clone/validate incoming JSON. Documents validate IDs, references, hierarchy, finite numbers, positive dimensions, and supported physics combinations.

- Units are meters, Y-up, +Z forward, left-handed coordinates. Rotations are unit quaternions. `quaternionFromDegrees` / `degreesFromQuaternion` convert pitch X, yaw Y, roll Z for authoring.
- Entity transforms are local to `parentId`; snapshots include `worldTransform`. `move(..., "local")` rotates displacement by the entity's world orientation without multiplying its scale. Reparent preserves world pose unless explicitly disabled.
- Parents with children require uniform positive scale. Cycles, negative/zero scale, and shear-producing reparent operations are rejected. Destroying a parent destroys its descendants; disabled state is inherited. Visibility controls an entity's own visual subtree.
- Visual geometry and collider dimensions are independent. Box dimensions can differ on XYZ. Sphere collider dimensions must match. Capsule collider X/Z diameters must match, height must be at least diameter, and sphere/capsule collider entity scale must be uniform.
- Colliders/bodies must be root entities. Visual children may attach beneath them. A collider without an explicit body behaves as static. A body requires a collider. Imported-model physics uses an explicitly supplied primitive collider.
- Teleporting, resizing/replacing a collider, changing mode, or changing rotation lock rebuilds the body and clears motion. Gravity, mass, color, material and ordinary metadata changes preserve motion. Dynamic bodies stay awake for immediate interactive changes.
- Raycast and overlap return the nearest supported hit or null, including entity ID, point, normal and distance. Overlap distance may be negative for penetration. Queries accept an excluded ID, trigger inclusion, and collision mask. Grounding casts down from a collider's center through its lower extent and rejects normals below `0.6` on Y; it is a basic ground probe, not a character-controller system.
- Assets use self-contained uncompressed GLB 2.0 and PNG/JPEG textures. External GLB buffers/images and codec-dependent compression are rejected. No asset upload service or CDN decoder is configured. Imported materials are preserved unless overridden; texture/material IDs belong to the project.
- Prefabs contain exactly one root and its subtree. Each instance gets fresh IDs and independent state. Prefab edits do not retroactively modify existing instances.

## Validation and boundaries

The test suite uses Babylon NullEngine with real Havok WASM, a real GLB fixture, and the same trusted demo adapter used in the page. It covers lifecycle restoration, cancellation and replacement loading, physics/queries/triggers, hierarchy rules and coordinate conversion, input/clock semantics, typed commands, shared assets, and repeated disposal/world swaps. Browser validation additionally checks rendering, asset/texture/WASM loading, camera/input behavior, inspector editing, and production bundling.

This foundation has no backend or website integration, student-code execution, Blockly, networking, voxel terrain, animation playback system, compound bodies/joints, touch/gamepad controls, or production editor. `test/demo.ts` is trusted application code, not a sandbox for untrusted scripts. This is an early API change from the initial cube demo; the old `shape/size/physics` spawn shorthand and `setPaused` method have been replaced by explicit entity definitions and lifecycle methods.

## Core gameplay contracts

Character components require an upright root dynamic capsule with `rotationLocked: true`. Defaults are speed 5 m/s, jump speed 6 m/s, slope limit 50 degrees, and the entity's authored pose as its spawn point. `characters.move(id, direction)` supplies world-space XZ intent for the next fixed tick; submit it from `onUpdate`. No new intent means no horizontal movement. Y is ignored, diagonal intent is normalized, and vertical velocity is preserved. Jump returns false while ungrounded or already jumping. Ground probes exclude triggers and the actor and check the configured slope limit. Turning updates the existing body pose; teleports and respawns clear velocity. Checkpoints call `setSpawn`; session spawn changes disappear on Stop.

`interactions.target(actorId)` raycasts along the actor's +Z forward direction from its origin. It returns an enabled, visible interaction collider within that target's configured distance, or null. Non-trigger solids block the ray. `interact` repeats those checks and returns whether an interaction was emitted. Interaction defaults are enabled, prompt `Interact`, and distance 3 meters. The demo moves relative to its camera but turns the actor toward travel, so its prompts follow the actor's facing direction.

World and entity properties accept JSON values only. `properties.get(null, "coins")` accesses world state; substitute an entity ID for entity state. Values and event payloads are detached. `set` creates or replaces a key; `remove` returns whether a key existed. The `property` event contains `entityId`, `key`, `previous`, and `value`; absent values are undefined. Metadata/component edits through `world.update` still emit the ordinary entity event; use `properties` when property-specific events are needed.

```ts
const player = runtime.world.spawn({
  tags: ["player"],
  transform: { position: { x: 0, y: 1.05, z: -5 } },
  visual: { kind: "capsule", size: { x: 1, y: 2, z: 1 } },
  collider: { shape: "capsule", size: { x: 1, y: 2, z: 1 } },
  body: { rotationLocked: true, friction: 0, restitution: 0 },
  character: {},
});
runtime.play();
runtime.onUpdate(() => {
  runtime.characters.move(player, {
    x: 0, y: 0, z: runtime.input.action("forward").held ? 1 : 0,
  });
  if (runtime.input.action("jump").pressed) runtime.characters.jump(player);
  if (runtime.input.action("interact").pressed) runtime.interactions.interact(player);
});
runtime.properties.set(null, "coins", 0);
runtime.feedback.setHud("coins", "Coins", 0);
```

`motion.glideTo(id, position, seconds, easing?)` and `rotateTo(id, quaternion, seconds, easing?)` use world-space destinations and simulation time. Duration must be positive. Easing is `linear` (default), `easeIn`, `easeOut`, or smoothstep `easeInOut`. Valid targets are enabled collider-free entities or kinematic bodies, excluding characters. Kinematic bodies use continuous Havok target poses and can push dynamic objects; velocity and impulses remain dynamic-body operations.

```ts
const action = runtime.motion.glideTo("door", { x: 0, y: 5.5, z: 4.5 }, 1.5, "easeInOut");
const result = await action.done; // { status: "completed" | "cancelled" | "failed", reason? }
// action.cancel() is idempotent.
```

Invalid requests throw before admission. An admitted action's promise always resolves with a result. One action owns an entity's pose at a time: a replacement cancels the old action. Teleport, reparent, collider changes, disabling, destruction, or incompatible body/controller changes also cancel it. Appearance, property, gravity, and material edits preserve it. Pause freezes actions; Stop, failed/replaced loads, unload, runtime errors, and disposal settle pending actions as cancelled. Normal completion is emitted after the final physics pose is synchronized. Session teardown settles promises and clears session output without emitting per-action completion events.

Feedback is session-only and readable through `feedback.get()`. `setHud(key, label, value)` replaces one keyed value; `notify(text, seconds = 3)` returns an ID for dismissal. Notifications expire in simulation time, including no aging while paused. `feedback` events carry detached snapshots. React renders these snapshots as text, never HTML. `target`, `respawn`, and `motion` events supplement the existing lifecycle, input, interaction, entity, collision, and trigger events.

## Placement and limits

Placement is an editing-only API with no React dependency. `begin({ primitive: "box" })`, `begin({ prefabId: "totem" })`, or `begin({ duplicateId })` creates a translucent preview. Use `cameras.ray(x, y)` with normalized canvas coordinates (-1 to +1, Y up), then pass its endpoints to `placement.aim`. `configure` changes grid spacing and rotation snapping; defaults are 1 meter and 90 degrees. `rotate()` advances one snap increment. `commit` rechecks validity and returns the new root ID. `cancel` is idempotent. Entering Play or tearing down a world cancels previews.

Placement uses physical surface hits with a Y=0 ground-plane fallback. Candidates stay upright, snap in world space and project onto the target surface, then offset by their combined visual/collider bounds. Collision checking conservatively uses the combined world-aligned bounding box, shrunk by 6 mm to tolerate touching surfaces; it can reject tight fits that exact mesh geometry would allow. Empty visual groups use a one-meter preview bound. Unsupported tilted roots are rejected. Duplicate keeps the subtree's internal parent relationships and mutable values but assigns fresh IDs. Arbitrary entity IDs stored inside custom properties are ordinary data and are not automatically rewritten. Preview nodes are excluded from physics, serialization, entity events, and shadow casting.

`createRuntime({ canvas, havokWasmUrl, limits: { entities: 2000, actions: 128, notifications: 32 } })` configures resource caps. Omitted limits use those defaults; overrides must be positive integers. Project load, prefab insertion, and duplicate placement check the entire entity count before committing. Limit failures use `LIMIT_EXCEEDED` and do not partially create subtrees.

This version deliberately has no step climbing, moving-platform riding, jump buffering, coyote time, automatic navigation, undo history, bulk construction, terrain voxels, inventory/combat system, audio, animation clips, or scripting integration. Gameplay rules remain in `test/demo.ts`. The separate scripting project is not imported or modified by the engine.
