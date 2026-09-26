// Runtime files for engine/ and scripting/, served from public/ by Next.js.
// scripts/copy-game-assets.mjs copies them there before `npm run dev` and `npm run build`.
//
// Engine and scripting only run in the browser: use them from "use client" components,
// and import them dynamically inside an effect (never at module top level of a server component).
export const HAVOK_WASM_URL = "/havok/HavokPhysics.wasm";
export const PYODIDE_URL = "/pyodide/";
export const SCRIPTING_WORKER_URL = "/scripting/worker.js";

// Pass as `workerFactory` to createGamePlayer: Next's bundler can't resolve the worker URL
// baked into @bark/scripting, so the built worker is served from public/ instead.
export const createPythonWorker = () => new Worker(SCRIPTING_WORKER_URL, { type: "module" });
