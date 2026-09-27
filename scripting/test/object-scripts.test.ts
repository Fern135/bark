import test from "node:test";
import assert from "node:assert/strict";
import { compileGame, parseGame, serializeGame } from "../src/game-file";
import { scriptFor, withScript, validateDocument, copyObjectScripts } from "../src/document";
import { compileBlocks, SELF } from "../src/blocks";
import { sampleDocument } from "../playground/sample";

test("object scripts round trip, legacy code stays global, and reading empty code is pure", async () => {
  const legacy = sampleDocument();
  const original = structuredClone(legacy);
  assert.deepEqual(scriptFor(legacy, "player"), { language: "blocks", workspace: {} });
  assert.deepEqual(legacy, original);
  const next = withScript(legacy, "player", { language: "python", source: "print(this.id)" });
  const saved = await parseGame(await serializeGame(next));
  assert.equal(saved.version, 2);
  assert.deepEqual(saved.script, legacy.script);
  assert.deepEqual(saved.objectScripts, next.objectScripts);
  assert.deepEqual(legacy, original);
  assert.throws(() => validateDocument({ ...next, objectScripts: { missing: next.script } }), /owner/);
});

test("programs compile in project order with independent source maps and valid empty scripts", async () => {
  let doc = withScript(sampleDocument(), "player", { language: "blocks", workspace: {} });
  doc = withScript(doc, "door", { language: "python", source: "value = 1" });
  const compiled = await compileGame(doc);
  assert.deepEqual(compiled.scripts.map((s) => s.scriptId), [null, ...doc.project.entities.filter((e) => doc.objectScripts?.[e.id]).map((e) => e.id)]);
  assert.equal(compiled.scripts.find((s) => s.scriptId === "player")?.python, "");
  assert.deepEqual(compiled.diagnostics, []);
});

test("this object is owner-relative, explicit targets survive, and global self references fail", () => {
  const workspace = { blocks: { blocks: [{ type: "bark_touch", id: "touch", fields: { ENTITY: SELF }, inputs: { DO: { block: { type: "bark_destroy", id: "destroy", inputs: { ENTITY: { block: { type: "bark_this", id: "self" } } } } } } }] } };
  const script = { language: "blocks" as const, workspace };
  const choices = { entities: [["Player", "player"] as [string, string]], prefabs: [], actions: [] };
  const compiled = compileBlocks(script, { ...choices, ownerId: "player" });
  assert.deepEqual(compiled.diagnostics, []);
  assert.match(compiled.python, /game.on_touch\(this.id\)/);
  assert.match(compiled.python, /await this.destroy\(\)/);
  assert.ok(compileBlocks(script, choices).diagnostics.some((d) => d.blockId === "self"));
  const explicit = structuredClone(script);
  explicit.workspace.blocks.blocks[0].fields.ENTITY = "player";
  assert.match(compileBlocks(explicit, { ...choices, ownerId: "door" }).python, /game.on_touch\("player"\)/);
});

test("duplication copies scripts independently and preserves owner-relative references", () => {
  const doc = withScript(sampleDocument(), "player", { language: "python", source: "print(this.id)" });
  const duplicated = copyObjectScripts(doc, { player: "player-copy", door: "door-copy" });
  assert.deepEqual(duplicated.objectScripts!["player-copy"], doc.objectScripts!.player);
  assert.notEqual(duplicated.objectScripts!["player-copy"], doc.objectScripts!.player);
  assert.equal(duplicated.objectScripts!["door-copy"], undefined);
  assert.equal(doc.objectScripts!["player-copy"], undefined);
});
