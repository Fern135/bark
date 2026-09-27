# Game files and the canvas player

## File contract

`GameDocument` exports version 2: `{ version: 2, project, script, objectScripts }`. Version 1 files are accepted as global-only games. `objectScripts` maps entity IDs to independent scripts. The project is the engine's normalized authored `ProjectDocument`; the script is the original blocks workspace or Python source, including its optional blocks backup. No compiled Python copy is stored. Blocks are compiled when validating and playing the file; Python runs only after explicit Play.

`serializeGame(document, { baseUrl?, signal? })` captures a detached document before its first asynchronous operation, validates the project and script references, fetches each distinct asset URL once, and returns formatted JSON. Script Lab supplies `runtime.exportProject()` and its current script, never the mutable running world. Failed/cancelled packaging returns no partial file and does not modify the editor. The browser must be allowed to fetch external assets (including CORS permission).

Each declared asset is retained with its original ID, but its URL becomes `data:model/gltf-binary;base64,...`, `data:image/png;base64,...`, or `data:image/jpeg;base64,...`. GLBs must be version 2, self-contained, and uncompressed; external buffers/images, Draco, meshopt and Basis compression are unsupported. Texture headers and container structure are checked during file validation; the engine performs actual texture/model decoding during load. All declared assets are packaged, even if not currently visible. Base64 increases file size; these files are intended for small authored games, not large asset archives.

`parseGame(json, { baseUrl?, signal? })` returns detached normalized data. It validates embedded asset bytes and block references (including backups) against the incoming project without executing Python or fetching external assets. Absolute HTTP/HTTPS and live blob URLs remain loadable for existing version-1 documents. Relative URLs require an explicit absolute `baseUrl`; the standalone file picker intentionally supplies none. Re-export legacy files from Script Lab to make them portable. Blob URLs are temporary until exported. Unsupported versions, scene-only JSON, invalid references, unknown blocks and malformed embedded assets are rejected. `GameFileError.diagnostics` retains block IDs for script validation failures. Python syntax/runtime errors are reported when Play prepares the worker.

A file saves designed defaults, not progress: no simulation clock, velocities, current collectible state, runtime properties, interpreter globals or session feedback. Engine scene exports and external trusted TypeScript demo code are not complete scripted game files. Havok, Python, package code and fonts are host resources, not embedded game assets. Files are for trusted game scripts under the existing worker execution model; the player adds no new sandbox or scripting capabilities.

## Plain-canvas example

Build `engine/` and `scripting/` first. In a Vite host, serve the pinned Python files from `scripting/public/pyodide/` at `/pyodide/`; keep the generated worker asset alongside the built scripting package.

```ts
import { createGamePlayer, serializeGame } from "@bark/scripting/player";
import havokWasmUrl from "@babylonjs/havok/lib/esm/HavokPhysics.wasm?url";

const canvas = document.querySelector<HTMLCanvasElement>("canvas")!;
const player = await createGamePlayer({
  canvas,
  havokWasmUrl,
  pythonRuntimeUrl: "/pyodide/",
});
const resize = new ResizeObserver(() => player.resize());
resize.observe(canvas);

// In a file input's change handler:
async function open(file: File) {
  await player.load(await file.text()); // displays authored scene; no Python execution
}
playButton.onclick = () => { void player.play().catch(showError); };
pauseButton.onclick = () => player.pause();
resumeButton.onclick = () => player.resume();
stopButton.onclick = () => player.stop();
restartButton.onclick = () => { void player.restart().catch(showError); };
const offFeedback = player.onFeedback(renderAccessibleHud);
const offStatus = player.onStatus(renderPlaybackControls);
const offDiagnostic = player.onDiagnostic(showDiagnostic);

// Separately, in an authoring host with its own engine and script document:
const json = await serializeGame({
  version: 2,
  objectScripts: {},
  project: authoringRuntime.exportProject(),
  script: currentScript,
}, { baseUrl: location.href });
// Download json as an application/json Blob.

function teardown() {
  resize.disconnect();
  offFeedback(); offStatus(); offDiagnostic();
  player.dispose();
}
```

The host supplies canvas sizing, file selection, buttons and HUD rendering. The player owns one engine and scripting session; it does not expose Babylon resources or editable world commands. Input requires canvas focus and is cleared on blur. `createGamePlayer` also accepts the engine's optional runtime limits and initialization AbortSignal, and an optional `workerFactory` for hosts whose bundler cannot resolve the packaged worker URL (such as Next.js); they serve the built `dist/assets/worker-*.js` themselves and return `new Worker(url, { type: "module" })`. An initialization signal only cancels initialization; use `dispose()` to release an established player.

## States, cancellation and observers

- `getSnapshot()` returns `{ status, name }`; `status` is also directly readable. States: empty, loading, ready, preparing, running, paused, error, disposed. `getFeedback()` returns detached HUD values, notifications and interaction prompt. Subscribe through `onStatus`, `onFeedback`, `onOutput`, and `onDiagnostic`; each returns an unsubscribe function. Read the initial snapshot explicitly. Observers receive detached values; throwing observers are logged without interrupting lifecycle completion.
- `load(json, { baseUrl?, signal? })` validates first. A structurally invalid import preserves an existing running session. Replacing a valid document stops the old session; resource failure recovers its authored scene and script in ready state. It does not resume prior gameplay. New loads, Stop and disposal invalidate pending work. A replacement during preparation cancels that worker even if the replacement is invalid.
- `play()` requires ready, prepares a fresh worker, and resolves after the engine and script session start. It does not wait for async start handlers. Pause/Resume require running/paused respectively. Stop cancels preparation or loading and restores the current authored document. Restart performs Stop then Play. Preparation errors restore the authored scene and report error; Stop or Restart allows another attempt. Script errors during play use the existing session's pause/error behavior.
- `resize()` updates the canvas renderer. `dispose()` terminates workers, aborts pending loads, removes player listeners, clears subscriptions, and releases the engine; it is idempotent. Stale operations reject and cannot commit into a newer session. Reentrant status/feedback observers may Stop or dispose without permitting stale notifications or unfinished preparations to restart the game.

## Validation

`npm test` includes codec tests and player lifecycle tests using real Havok with Babylon NullEngine and controlled workers. Browser tests exercise real local Pyodide, WebGL, portable GLB/PNG/JPEG import, blocks and Python, input focus, HUD, Play/Pause/Stop/Restart, resizing, and a built-library consumer. Run `npm run build` before development browser tests and `npm run build:playground` before production tests. See [test/PLAYER-VALIDATION.md](test/PLAYER-VALIDATION.md) for recorded results and limits.
