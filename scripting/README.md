# Bark Script Lab

One game, one script, two authoring modes: Blockly blocks or Python. Blocks compile to readable Python; both execute in a local Pyodide Web Worker. The engine owns rendering, physics, input, and world restoration. No Python server is involved.

## Run

Node 22.12+ is required. The sibling `@bark/engine` package must have its public build in `engine/dist`. If it has not been built, its owner should run `npm ci` and `npm run build` in `engine/` first.

```powershell
cd C:\dev\bark\scripting
npm ci
npm run dev
```

Open **http://127.0.0.1:5174/**. Choose **Prepare Python**, then **Play**. Click the world before using WASD/arrows, Space to jump, or R to spawn a crate. Collect three gems and reach the purple goal. Stop restores the authored world and discards script state.

The block example and the **Load Python example** button implement the same game. Gameplay is visible in the script; no hidden demo controller is attached.

| Command                    | Purpose                                                             |
| -------------------------- | ------------------------------------------------------------------- |
| `npm run dev`              | Local playground, strict port 5174                                  |
| `npm run typecheck`        | Check runtime, editors, adapter, tests                              |
| `npm test`                 | Compiler, persistence, and fake-engine lifecycle tests              |
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

For continuous movement use `await player.set_velocity(dx, None, dz)`. Preserving Y inside the engine adapter prevents a delayed script velocity read from overwriting a jump or gravity. Movement blocks are displacements, not swept character-controller movement.

Use `await game.next_frame()` in handwritten loops that otherwise never await. Generated loops insert this checkpoint automatically. Pausing gates gameplay operations, event delivery, and simulation waits; it does not freeze arbitrary pure Python computation. Stop terminates even an infinite Python loop.

Interaction events are supplied by the host engine. Binding a key to an action does not automatically perform a raycast or dispatch an interaction. In the current engine, a target needs an authored interaction component and collider; the actor must face it within range without an obstruction. The adapter forwards accepted interaction events and preserves these engine checks.

## Authoring and persistence

The outer document is `{ version: 1, project, script }`. `project` is an unchanged engine `ProjectDocument`. `script` is either `{ language: "blocks", workspace }` or `{ language: "python", source, blocksBackup? }`.

Export saves authored state, not runtime changes. Import validates both documents before loading. Blockly workspace JSON preserves block IDs, variable IDs, and layout. Converting to Python stores a detached block backup. **Restore saved blocks** replaces the current Python script with that backup; Python edits are never translated back into blocks.

Blocks cover events, movement and physics, prefabs, sensing, variables, arithmetic, comparisons, conditions, repeat/while/forever/for-each loops, waits, and output. Generated Python has a line-to-block source map. Runtime errors highlight the responsible statement block; handwritten errors refer to the original Python line. Full tracebacks are available to host diagnostic subscribers.

The public runtime entry imports no Blockly or React. Import the optional compiler from `@bark/scripting/blocks` and the engine adapter from `@bark/scripting/engine`. Future language compilers produce the same `Compilation` result; Lua is not implemented or offered in the UI.

See [ENGINE-CONTRACT.md](./ENGINE-CONTRACT.md) for host integration and lifecycle ordering.

## Boundaries

This is a local hackathon authoring environment, not a secure service for running hostile shared programs. The worker isolates execution from the UI thread, not from all browser capabilities. Python standard-library behavior is Pyodide's browser behavior. Arbitrary external packages, filesystem persistence, multiplayer, per-object scripts, and text-to-block conversion are outside this version.

The renderer, Blockly, and Python runtime make the playground a large bundle; the library's runtime and adapter remain separate exports. Runtime URLs must be same-origin/local assets for this setup. A failed asset load appears as a diagnostic and can be retried after Stop.
