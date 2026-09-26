# Scripting ↔ engine integration contract

The scripting layer consumes `@bark/engine` public exports only. It owns a small adapter and never accesses Babylon objects. Engine implementation changes should require changes only in `createEngineAdapter`.

## Host setup

```ts
import { createScriptingSession, compilePython } from "@bark/scripting";
import { createEngineAdapter } from "@bark/scripting/engine";

// The host creates and loads an engine runtime first; runtime.state === "editing".
const scripting = createScriptingSession(createEngineAdapter(runtime), {
  runtimeUrl: "/pyodide/",
});
const offOutput = scripting.onOutput(({ text, stream }) => console.log(stream, text));
const offError = scripting.onDiagnostic(({ message, line, blockId, traceback }) => {
  // Highlight line/blockId and display the traceback as appropriate.
});

await scripting.prepare(compilePython({ language: "python", source }));
scripting.play();
// scripting.pause(); scripting.resume(); scripting.stop();

// Before host teardown:
offOutput();
offError();
scripting.dispose();
runtime.dispose();
```

For blocks use `setBlockChoices` and `compileBlocks` from `@bark/scripting/blocks`. Populate entity/prefab/action choices from the authored project before compiling or mounting the editor. Do not run a second gameplay demo/controller alongside scripts.

Consumers serve the package's `public/pyodide` directory at `runtimeUrl`, with its directory structure unchanged. The ESM library references its bundled worker asset relative to `import.meta.url`; preserve the `dist/assets` directory when hosting the library. Use a bundler supporting module workers, such as Vite.

## Required engine behavior

| Public surface                                                    | Scripting dependency                                                  |
| ----------------------------------------------------------------- | --------------------------------------------------------------------- |
| `state`, `clock`, `play/pause/resume/stop`                        | Lifecycle ownership and restoration                                   |
| `onUpdate`                                                        | Fixed-step callback before physics; commands and queries execute here |
| `on("state")`                                                     | Detect external Stop, load, unload, errors, and disposal              |
| `on("collision"/"trigger"/"interaction", ..., {scope:"session"})` | Gameplay events after physics                                         |
| `world.get/list/destroy/spawnPrefab`                              | Entity access, tag lookup, deletion and prefab instances              |
| `transforms.move/set`                                             | Displacements and local rotation                                      |
| `physics.velocity/setVelocity/applyImpulse/grounded`              | Physics actions and observations                                      |
| `input.action/bindings`                                           | Named action state and available bindings                             |
| Rotation conversion helpers                                       | Degree-based authoring over engine quaternions                        |

Operations complete synchronously inside the adapter. Queries return detached/plain data; commands return plain results or throw. Units are meters, seconds, Y-up, local +Z forward. IDs identify entities; names are display labels only.

Input is sampled during the adapter's fixed update. It synthesizes a release when a formerly held action becomes false, including after canvas blur or pause, because clearing the engine's input state may not emit its own release event.

## Lifecycle ordering

1. Load and validate the authored engine project.
2. Compile the single script. `prepare` creates a worker, loads local Pyodide, executes module setup, and registers handlers. The promise resolves in `ready`; it can be cancelled by Stop.
3. `play` calls engine Play, then registers session events and updates, then dispatches the script's start event. This ordering is required because engine Play clears session callbacks.
4. Worker operations queue until the next engine update. Apply a snapshot of that queue before physics, replying only after each operation executes. An awaited result may take more than one rendered frame; rendering and physics never wait on Python.
5. Pause holds requests and timers. Resume continues them with preserved interpreter state. Arbitrary Python calculations are not forcibly suspended.
6. Stop increments the session generation before terminating the worker, clears pending work and callbacks, and calls engine Stop to restore authored state. A new Play requires another prepare.
7. External load/unload/Stop invalidates the worker. Uncaught script failures terminate it, pause a running engine, emit a diagnostic, and require Stop before restart.
8. Dispose removes persistent state listeners too. The host remains responsible for renderer disposal.

Engine lifecycle actions should normally go through the scripting session while it owns a game. The host can replace worlds by stopping the session and calling engine load; external engine state changes are observed as a cleanup fallback.

## Messages and limits

All worker messages carry a numeric session generation. Requests and responses also carry a request ID; old-session messages are ignored. Operation payloads are a typed discriminated union in `src/types.ts`, with plain JSON-compatible values. Engine exceptions reject Python's awaited call.

One clock message may be outstanding; intermediate ticks coalesce to the newest clock. This is asynchronous gameplay coordination, not deterministic lockstep. Waits target absolute simulation time, so missed intermediate ticks do not lengthen their requested simulated duration.

There are at most 256 queued engine operations and 256 unacknowledged host events. Python additionally limits queued handler invocations to 256 in total. Overflow ends the script with an actionable error. Each handler has one sequential consumer; different handlers can overlap at await points. An infinitely running handler can therefore exhaust its queue if repeatedly triggered.

Output is batched every 30 ms, capped per batch, and the playground retains the latest 250 lines. This is intentionally not a full logging system. Unknown entities/operations and engine failures produce errors rather than silent successful no-ops, except where the engine explicitly defines a result such as `destroy` returning false.

## Future languages

A frontend compiler returns `{ python, sourceMap, diagnostics }`. Only Python reaches the execution worker. Blocks are the implemented compiler frontend; handwritten Python passes through unchanged. A future Lua compiler must define its supported semantics and map source locations, while leaving the worker/engine protocol unchanged.
