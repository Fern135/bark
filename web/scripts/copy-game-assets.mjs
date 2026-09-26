// Copies the browser runtime files the engine and scripting packages need into public/,
// so Next.js serves them locally (the web container has no internet access):
//   public/pyodide/              <- @bark/scripting's pinned Pyodide files
//   public/havok/HavokPhysics.wasm <- Havok physics WASM used by @bark/engine
//   public/scripting/worker.js     <- @bark/scripting's built Python worker (Next can't resolve its packaged URL)
import { cp, mkdir, readdir, realpath } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";

const scriptingPath = resolve("node_modules/@bark/scripting");
if (!existsSync(scriptingPath)) {
  throw new Error("@bark/scripting is not in node_modules. It is supplied by the Docker build; run web with docker compose (see README).");
}
const scriptingDir = await realpath(scriptingPath);

const pyodideSource = join(scriptingDir, "public/pyodide");
if (!existsSync(join(pyodideSource, "pyodide.mjs"))) {
  throw new Error(`Pyodide files missing in ${pyodideSource}.`);
}
const pyodideTarget = resolve("public/pyodide");
await mkdir(pyodideTarget, { recursive: true });
for (const file of await readdir(pyodideSource)) {
  await cp(join(pyodideSource, file), join(pyodideTarget, file));
}

// Resolve Havok from the engine, which loads the matching Havok JS at runtime.
const engineDir = await realpath(resolve("node_modules/@bark/engine"));
const requireFromEngine = createRequire(join(engineDir, "package.json"));
const havokWasm = requireFromEngine.resolve("@babylonjs/havok/lib/esm/HavokPhysics.wasm");
await mkdir(resolve("public/havok"), { recursive: true });
await cp(havokWasm, resolve("public/havok/HavokPhysics.wasm"));

const workerDir = join(scriptingDir, "dist/assets");
const worker = existsSync(workerDir) && (await readdir(workerDir)).find((f) => /^worker-.*\.js$/.test(f));
if (!worker) throw new Error(`Built worker missing in ${workerDir}.`);
await mkdir(resolve("public/scripting"), { recursive: true });
await cp(join(workerDir, worker), resolve("public/scripting/worker.js"));

console.log("Copied Pyodide, Havok and scripting worker into public/.");
