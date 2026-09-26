import { cp, mkdir, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const source = dirname(require.resolve("pyodide/package.json"));
const target = resolve("public/pyodide");
await mkdir(target, { recursive: true });
for (const file of await readdir(source)) {
  if (/\.(mjs|js|wasm|zip|json)$/.test(file))
    await cp(resolve(source, file), resolve(target, file));
}
console.log("Pinned Pyodide browser assets copied to public/pyodide.");
