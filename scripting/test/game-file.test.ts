import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createProject, validateProject } from "@bark/engine";
import { parseGame, serializeGame, GameFileError } from "../src/game-file";
import { sampleDocument } from "../playground/sample";

test("blocks and Python round trip normalized authored documents without mutating them", async () => {
  for (const language of ["blocks", "python"] as const) {
    const original = sampleDocument();
    const script = language === "blocks" ? original.script : { language, source: "print('ready')", blocksBackup: original.script.language === "blocks" ? original.script.workspace : {} };
    const doc = { ...original, script }, captured = structuredClone(doc);
    const saving = serializeGame(doc);
    doc.project.name = "Edited after capture";
    const loaded = await parseGame(await saving);
    assert.deepEqual(loaded, { ...captured, project: validateProject(captured.project) });
    loaded.project.properties!.score = 999;
    assert.equal(doc.project.properties!.score, 0);
  }
});

test("asset packaging embeds GLB and PNG bytes, deduplicates fetches and resolves explicit bases", async (t) => {
  const model = await readFile(new URL("../../engine/test/fixtures/gem.glb", import.meta.url));
  const png = await readFile(new URL("../../engine/test/fixtures/tile.png", import.meta.url));
  const requests: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: string) => {
    requests.push(url);
    return new Response(new Uint8Array(url.endsWith(".glb") ? model : png));
  });
  const project = createProject();
  project.assets = [{ id: "gem", type: "model", url: "gem.glb" }, { id: "tile", type: "texture", url: "tile.png" }, { id: "tile-copy", type: "texture", url: "tile.png" }];
  const doc = { version: 1 as const, project, script: { language: "python" as const, source: "pass" } };
  await assert.rejects(serializeGame(doc), /baseUrl/);
  const saved = JSON.parse(await serializeGame(doc, { baseUrl: "https://assets.example/games/" }));
  assert.deepEqual(requests, ["https://assets.example/games/gem.glb", "https://assets.example/games/tile.png"]);
  assert.equal(saved.project.assets[0].url, `data:model/gltf-binary;base64,${model.toString("base64")}`);
  assert.equal(saved.project.assets[1].url, `data:image/png;base64,${png.toString("base64")}`);
  assert.equal(saved.project.assets[1].url, saved.project.assets[2].url);
  assert.equal(doc.project.assets[0].url, "gem.glb");
  t.mock.restoreAll();
  assert.deepEqual(await parseGame(JSON.stringify(saved)), saved);
});

test("invalid references in nested blocks and backups retain block-specific diagnostics", async () => {
  const doc = sampleDocument();
  const workspace = { blocks: { languageVersion: 0, blocks: [{ type: "bark_start", inputs: { DO: { block: { type: "bark_destroy", inputs: { ENTITY: { shadow: { type: "bark_entity", id: "missing-block", fields: { ENTITY: "no-such-entity" } } } } } } } }] } };
  for (const script of [{ language: "blocks", workspace }, { language: "python", source: "pass", blocksBackup: workspace }]) {
    await assert.rejects(parseGame(JSON.stringify({ ...doc, script })), (error: unknown) => {
      assert.ok(error instanceof GameFileError); assert.equal(error.diagnostics[0].blockId, "missing-block"); return true;
    });
  }
  await assert.rejects(parseGame("oops"), /valid game JSON/);
  await assert.rejects(parseGame(JSON.stringify({ ...doc, version: 2 })), /Unsupported/);
  await assert.rejects(parseGame(JSON.stringify(doc.project)), /incomplete/);
});

test("failed, corrupt, external-buffer and cancelled assets never mutate the source", async (t) => {
  const doc = { version: 1 as const, project: createProject(), script: { language: "python" as const, source: "pass" } };
  doc.project.assets = [{ id: "broken", type: "model", url: "https://assets.example/missing.glb" }];
  t.mock.method(globalThis, "fetch", async () => new Response("missing", { status: 404 }));
  await assert.rejects(serializeGame(doc), /broken.*HTTP 404/);
  t.mock.restoreAll();
  doc.project.assets[0].url = "data:model/gltf-binary;base64,YmFk";
  await assert.rejects(serializeGame(doc), /GLB/);
  await assert.rejects(parseGame(JSON.stringify(doc)), /GLB/);
  doc.project.assets[0] = { id: "broken", type: "texture", url: "data:image/png;base64,YmFk" };
  await assert.rejects(parseGame(JSON.stringify(doc)), /PNG or JPEG/);
  const abort = new AbortController(); abort.abort();
  await assert.rejects(serializeGame(doc, { signal: abort.signal }), /cancelled/);
  const json = JSON.stringify({ asset: { version: "2.0" }, buffers: [{ uri: "external.bin" }] }).padEnd(100, " ");
  const bytes = Buffer.alloc(120); bytes.writeUInt32LE(0x46546c67, 0); bytes.writeUInt32LE(2, 4); bytes.writeUInt32LE(120, 8); bytes.writeUInt32LE(100, 12); bytes.writeUInt32LE(0x4e4f534a, 16); bytes.write(json, 20);
  doc.project.assets[0] = { id: "broken", type: "model", url: `data:model/gltf-binary;base64,${bytes.toString("base64")}` };
  await assert.rejects(serializeGame(doc), /must be embedded/);
});

test("aborting asset download rejects packaging; legacy URLs require no fetch during parse", async (t) => {
  const doc = { version: 1 as const, project: createProject(), script: { language: "python" as const, source: "pass" } };
  doc.project.assets = [{ id: "slow", type: "model", url: "https://assets.example/slow.glb" }];
  const abort = new AbortController();
  let fetching!: () => void;
  const started = new Promise<void>((resolve) => { fetching = resolve; });
  t.mock.method(globalThis, "fetch", async (_url: string, options: RequestInit) => new Promise((_resolve, reject) => {
    options.signal!.addEventListener("abort", () => reject(new Error("aborted")), { once: true }); fetching();
  }));
  assert.equal((await parseGame(JSON.stringify(doc))).project.assets[0].url, doc.project.assets[0].url);
  const saving = serializeGame(doc, { signal: abort.signal }); await started; abort.abort();
  await assert.rejects(saving, /cancelled/);
});
