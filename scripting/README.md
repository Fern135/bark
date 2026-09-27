# Bark Script Lab

One global script and one script per object, each authored with Blockly blocks or Python. Blocks compile to readable Python; both execute in a local Pyodide Web Worker. The engine owns rendering, physics, input, and world restoration. No Python server is involved.

## Run

Node 22.12+ is required. The sibling `@bark/engine` package must have its public build in `engine/dist`. If it has not been built, its owner should run `npm ci` and `npm run build` in `engine/` first.

```powershell
cd C:\dev\bark\scripting
npm ci
npm run dev
```

Open **http://127.0.0.1:5174/**. Choose **Prepare Python**, then **Play**. Click the world before using WASD/arrows, Space to jump, E to interact, or R to spawn a crate. Collect six points from three gems, open the gate, and reach the purple goal. Stop restores the authored world and discards script state.

The block example and the **Load Python example** button implement the same game. Gameplay is visible in the script; no hidden demo controller is attached.

## Portable games and viewport player

**Export game** packages the engine's authored scene and the current script into `<game-name>.bark.json`. GLB models and PNG/JPEG textures are embedded as data URLs, so the file travels with its assets. Open **http://127.0.0.1:5174/player/** (or `/player/` on production preview port 4174), choose the file, and press **Play**. Import displays the scene without preparing or executing Python. Pause freezes the session; Stop restores authored defaults; Restart creates a fresh Python worker and starts again.

The optional React-free `@bark/scripting/player` entry point provides the same behavior for a host application's canvas. See [PLAYER.md](PLAYER.md) for API usage, file contracts, asset restrictions, and lifecycle rules. No website or backend integration is required.

| Command                    | Purpose                                                             |
| -------------------------- | ------------------------------------------------------------------- |
| `npm run dev`              | Local playground, strict port 5174                                  |
| `npm run typecheck`        | Check runtime, editors, adapter, tests                              |
| `npm test`                 | Compiler, portable files, real-Havok player and session tests       |
| `npm run test:browser`     | Real Pyodide and Havok tests in Chromium; run `build` first         |
| `npm run test:production`  | Built playground smoke test; run `build:playground` first           |
| `npm run build`            | Library ESM, bundled worker, and TypeScript declarations in `dist/` |
| `npm run build:playground` | Deployable playground in `dist-playground/`                         |
| `npm run preview`          | Production playground at port 4174                                  |

For browser tests, run `npx playwright install chromium` once. To use an installed Chrome instead, set `$env:BARK_BROWSER_CHANNEL='chrome'` before running them. Tests launch their own browser and do not use personal browser profiles. Development tests use an isolated server on port 5175 with hot reload disabled, so another agent rebuilding the engine cannot reload the test page. The interactive playground remains on port 5174.

`npm ci` copies the pinned Pyodide files to `public/pyodide/`. The playground build includes them locally. Runtime downloads, third-party package installation, and arbitrary Python package imports are not part of the UI. The initial preparation loads roughly 13 MB of Python assets; subsequent workers reuse the browser's asset cache. Stop destroys the worker, so preparing again resets the interpreter too.

## Python API

```python
from bark import game

score = 0

@game.on_start
async def start():
    player = game.entity("player")
    await player.move_forward(1)
    await game.wait(0.25)
    print("Ready")

@game.on_input("jump")
async def jump(state):
    player = game.entity("player")
    if state.pressed and await player.grounded():
        await player.apply_impulse(0, 6, 0)

@game.on_touch("player")
async def collect(other_id):
    global score
    if other_id == "gem1":
        await game.entity(other_id).destroy()
        score += 1
        print(score)
```

Every event handler must be an `async def`. The module body defines variables, entity handles, and handlers; awaited gameplay operations belong inside handlers. Each handler processes its events in order, with one invocation at a time; different handlers run cooperatively. Events arriving while a forever handler runs remain queued, so put forever loops under the start event rather than repeated input events.

| API                                          | Semantics                                                                |
| -------------------------------------------- | ------------------------------------------------------------------------ |
| `@game.on_start`                             | Called once after engine Play and callback registration                  |
| `@game.on_input(action)`                     | Named project action changes; argument has `pressed`, `held`, `released` |
| `@game.on_touch(id)`                         | Collision start or trigger enter; argument is the other entity ID        |
| `@game.on_interact(id)`                      | Engine interaction event; argument is actor ID or `None`                 |
| `game.entity(id)`                            | Local ID handle; existence is checked when the engine operation executes |
| `await game.find(tag=...)`                   | List of entity handles                                                   |
| `await game.input(action)`                   | Current action state with attribute access                               |
| `await game.spawn(prefab_id, x=0, y=0, z=0)` | Spawn a project prefab and return its root handle                        |
| `await entity.move(x, y, z, space="world")`  | Immediate displacement; also accepts `"local"`                           |
| `await entity.move_forward(distance)`        | Immediate local +Z displacement                                          |
| `await entity.turn(degrees)`                 | Add local Y yaw, preserving authored pitch and roll                      |
| `await entity.set_velocity(x, y, z)`         | Set velocity; `None` preserves an axis at execution time                 |
| `await entity.apply_impulse(x, y, z)`        | Apply physics impulse                                                    |
| `await entity.destroy()`                     | Destroy entity and descendants; return engine result                     |
| `await entity.position()` / `velocity()`     | Return `.x`, `.y`, `.z` values; position is world space                  |
| `await entity.grounded()`                    | Engine's basic ground probe                                              |
| `await game.wait(seconds)`                   | Wait for simulation time; nonnegative, finite duration                   |
| `await game.next_frame()`                    | Resume on a later simulation tick                                        |
| `game.elapsed`, `game.tick`, `game.delta`    | Last clock update received by Python                                     |
| `print(...)`                                 | Playground output, bounded and batched                                   |

For character movement use `await player.walk(dx, dz)` and `await player.jump()`. For lower-level physics use `await entity.set_velocity(dx, None, dz)`; preserving Y inside the engine adapter prevents a delayed velocity read from overwriting gravity. The original move/move-forward blocks remain immediate displacements.

Use `await game.next_frame()` in handwritten loops that otherwise never await. Generated loops insert this checkpoint automatically. Pausing gates gameplay operations, event delivery, and simulation waits; it does not freeze arbitrary pure Python computation. Stop terminates even an infinite Python loop.

Interaction events are supplied by the host engine. Binding a key to an action does not automatically perform a raycast or dispatch an interaction. In the current engine, a target needs an authored interaction component and collider; the actor must face it within range without an obstruction. The adapter forwards accepted interaction events and preserves these engine checks.

## Authoring and persistence

The outer document is `{ version: 2, project, script, objectScripts }`. Version 1 documents remain readable with their original global script; exports use version 2. `objectScripts` maps existing entity IDs to scripts. `project` is an unchanged engine `ProjectDocument`. `script` is either `{ language: "blocks", workspace }` or `{ language: "python", source, blocksBackup? }`.

Export saves authored state, not runtime changes. Import validates both documents before loading. Blockly workspace JSON preserves block IDs, variable IDs, and layout. Converting to Python stores a detached block backup. **Restore saved blocks** replaces the current Python script with that backup; Python edits are never translated back into blocks.

Blocks cover events, movement and physics, prefabs, sensing, variables, arithmetic, comparisons, conditions, repeat/while/forever/for-each loops, waits, and output. Generated Python has a line-to-block source map. Runtime errors highlight the responsible statement block; handwritten errors refer to the original Python line. Full tracebacks are available to host diagnostic subscribers.

The public runtime entry imports no Blockly or React. Import the optional compiler from `@bark/scripting/blocks` and the engine adapter from `@bark/scripting/engine`. Future language compilers produce the same `Compilation` result; Lua is not implemented or offered in the UI.

See [ENGINE-CONTRACT.md](./ENGINE-CONTRACT.md) for host integration and lifecycle ordering.

## Boundaries

This is a local hackathon authoring environment, not a secure service for running hostile shared programs. The worker isolates execution from the UI thread, not from all browser capabilities. Python standard-library behavior is Pyodide's browser behavior. Arbitrary external packages, filesystem persistence, multiplayer, per-object scripts, and text-to-block conversion are outside this version.

The renderer, Blockly, and Python runtime make the playground a large bundle; the library's runtime and adapter remain separate exports. Runtime URLs must be same-origin/local assets for this setup. A failed asset load appears as a diagnostic and can be retried after Stop.

## Gameplay expansion

The **Coin gate** sample uses a dynamic capsule character, gems worth 1/2/3 points, an interactable kinematic gate, a checkpoint, and a goal. Collect all six points, face the gate, and press **E**. The visible `try_open(cost)` function checks the score, glides the gate aside, and returns a boolean. A broadcast announces success. The blue checkpoint changes your spawn; walking off the meadow demonstrates respawning. The goal spawns a reward crate and cancels the countdown. Reaching zero on the countdown displays a message but permits continued exploration.

Both examples keep this gameplay in their global script. Stop restores all authored entities and properties, resets the checkpoint, clears HUD/notifications, and discards timers and Python variables.

All operations below are awaited; event decorators and property/ID handles are local:

| Python API | Result / behavior |
| --- | --- |
| `entity.walk(x, z)` | Retain a world-space direction at the character's configured speed until changed; `(0, 0)` stops |
| `entity.jump()` | Boolean: whether the grounded jump was accepted |
| `entity.teleport(x, y, z)` | Move the character immediately, preserving orientation |
| `entity.set_spawn(x, y, z)` / `respawn()` | Set a checkpoint with current orientation / restore it |
| `game.target(actor_id)` | Entity handle or `None` |
| `game.interact(actor_id, target_id=None)` | Boolean; respects facing, range, visibility, and obstruction |
| `entity.glide_to(x, y, z, seconds, easing="linear")` | Await motion; dictionary with `status` and optional `reason` |
| `entity.rotate_to(y_degrees, seconds, easing="linear")` | Absolute local Y rotation, preserving X/Z; same result dictionary |
| `game.set_hud(key, label, value)` / `remove_hud(key)` | Replace / remove one text HUD entry |
| `game.notify(text, seconds=3)` | Temporary text notification; returns notification ID |
| `@game.on_touch_end(id)` | Collision end or trigger exit; receives other entity ID |
| `@game.on_respawn(id)` | No arguments; fires after the engine respawns that character |

Characters require the engine's character component and a root, dynamic, upright capsule with locked rotation. Timed motion requires a non-character entity with no collider or a kinematic body. Durations must be positive; easing is `linear`, `easeIn`, `easeOut`, or `easeInOut`. Motion results are `completed`, `cancelled`, or `failed`; a newer motion replaces the previous motion on that entity. Invalid configuration raises an exception. Pending motions pause with the world and are cancelled on Stop. The sample script polls current input and refreshes walking; hosts must supply viewport focus information as described in the integration contract.

### Properties and authoring

Use `game.properties` for the world and `game.entity(id).properties` for an entity. Both support `await get(key, default=None)`, `has(key)`, `set(key, value)`, `change(key, amount)`, `remove(key)`, and `list()`.

Values must be JSON-compatible. A stored `None` remains `None`; `get` uses its default only for an absent key. `change` atomically adds a finite number to an existing numeric property and returns the result. Missing/nonnumeric values raise an exception. `remove` returns whether the key existed; `list` returns a detached dictionary.

Expand **Properties** below the console to select the world or an entity, inspect its values, and enter a key plus JSON value. Save/Remove are available when stopped. Starting properties remain part of the unchanged engine project schema; runtime edits never overwrite the saved project. The property-key block offers target-specific suggestions and permits typing new keys.

### My Blocks, lists, text, and randomness

**My Blocks** provides procedures with parameters, optional results, and conditional early returns. All generated functions are async and all calls await them, so functions can wait or invoke engine actions. Parameters are local even if a workspace variable has the same name; other workspace variables are game-wide. Definitions precede event handlers, and invalid saved calls produce diagnostics before Blockly can repair them silently.

**Lists & text** includes lists, zero-based get/set/removal, append, membership, length, joins, text/number conversion, and slicing. The first index is **0**; slice end is **exclusive**, matching Python. Python's normal negative indices and range errors apply. Random integer endpoints are inclusive; random floats are in `[0, 1)`. Ordinary Python lists, strings, functions, and `random` remain available in handwritten scripts.

### Messages and timers

```python
@game.on_message("gate_opened")
async def announce(payload):
    await game.notify(f"Gate opened with {payload['score']} points")

@game.on_timer("countdown")
async def countdown():
    remaining = await game.properties.change("seconds", -1)
    await game.set_hud("time", "Time", remaining)
    if remaining <= 0:
        await game.cancel_timer("countdown")

# Inside a handler:
# await game.broadcast("gate_opened", {"score": 6})
# await game.start_timer("countdown", 1, repeat=True)
```

Broadcasts enqueue a JSON snapshot independently for each receiver and do not wait for receivers to finish. Each handler processes one invocation at a time. Named timers use simulation time; starting the same name replaces its schedule and pending firings. Cancel removes future and queued firings but does not interrupt an already-running invocation. Repeating timers skip missed intervals and queue at most one pending firing per handler. One-shot timers default to `repeat=False`. Names must be nonempty strings; timers require positive finite durations and are limited to 256 active names.

### Live inspection

Expand **Live inspection** and enable it before or during execution. The panel shows global variables, current locals, source line/block, and the latest 200 handler start/completion events. Execution highlights are separate from errors and do not move the editor viewport. Inspection is opt-in, sampled at most 10 times per second, and intentionally shows bounded previews: 100 scope entries, 20 collection items, three nesting levels, and 200 characters per string. Unsupported objects appear as placeholders; watches do not evaluate expressions or invoke user representations.

Generated statements include lightweight markers; handwritten Python is traced only while inspection is enabled. Inspection is best effort during CPU-heavy code. It adds overhead and is not a breakpoint/step debugger. Stop still terminates the worker immediately.

## Object code

Selecting an object in the editor opens its code; choosing World or clearing selection opens global code. The Code browser includes child objects. Opening an unedited object presents an empty Blocks workspace without saving anything. Empty scripts are valid no-ops.

Object code has a Python `this` entity handle and a **this object** block. New object selectors default to the owner; explicit entity references remain explicit. Conversion and saved block backups belong to each individual script.

`compileGame(document)` produces a `CompiledProgram` with independently mapped compilations, ordered global first and then by project entity order. `session.prepare` accepts this program or a legacy single `Compilation`. One worker registers every script before Start. Each script has its own Python namespace and named timers. World properties and messages are shared. Do not use bare Python globals to share state across scripts.

```python
from bark import game

@game.on_start
async def start():
    await this.properties.set("health", 100)
    await game.broadcast("ready", this.id)
```

Diagnostics and inspection snapshots carry `scriptId` (`null` for global code), preserving original lines and block IDs. Stop discards every script together. Destroying an owner cancels its callbacks, waits, and queued commands. Runtime changes remain temporary.

Authored duplication emits the engine's `entityDuplicate` event containing the source-to-copy ID map. Hosts use `copyObjectScripts(document, ids)` with the updated project; the editor and playground do this automatically. Owner-relative references follow the copy; explicit references keep their original targets.

The block audit covers all 98 exposed block types, their dropdown modes, and missing required inputs. Browser fixtures execute generated Python against the engine, including cooperative loops and Stop. Run `npm test` and `npm run test:browser` from this package.
