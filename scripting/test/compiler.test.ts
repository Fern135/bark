import test from "node:test";
import assert from "node:assert/strict";
import { compileBlocks, setBlockChoices } from "../src/blocks";
import { compilePython, convertToPython, restoreBlocks, validateDocument } from "../src/document";
import { sampleDocument, sampleWorkspace } from "../playground/sample";

const doc = sampleDocument();
setBlockChoices({
  entities: doc.project.entities.map((e) => [e.name, e.id]),
  prefabs: [["crate", "crate"]],
  actions: Object.keys(doc.project.input).map((a) => [a, a]),
});
test("sample compiles shared variables, nested conditions, events, and cooperative loops", () => {
  const result = compileBlocks(doc.script);
  assert.deepEqual(result.diagnostics, []);
  assert.match(result.python, /global v_score_0, v_dx_1, v_dz_2/);
  assert.match(result.python, /while True:\n\s+await game.next_frame\(\)/);
  assert.match(result.python, /@game.on_touch\("player"\)/);
  assert.match(result.python, /else:\n/);
  assert.ok(Object.keys(result.sourceMap).length > 30);
});
test("invalid block placement and disconnected required inputs produce block diagnostics", () => {
  const bad = compileBlocks({
    language: "blocks",
    workspace: {
      blocks: {
        languageVersion: 0,
        blocks: [
          { type: "bark_start", inputs: { DO: { block: { type: "bark_destroy", id: "bad" } } } },
          { type: "math_number", id: "loose" },
        ],
      },
    },
  });
  assert.ok(bad.diagnostics.some((d) => d.blockId === "bad" && d.message.includes("entity")));
  assert.ok(bad.diagnostics.some((d) => d.blockId === "loose"));
});
test("block conversion retains a detached backup and Python edits do not change it", () => {
  const script = { language: "blocks" as const, workspace: sampleWorkspace() };
  const converted = convertToPython(script, compileBlocks(script));
  assert.equal(converted.language, "python");
  if (converted.language !== "python") return;
  converted.source = "print('edited')";
  assert.equal(compilePython(converted).python, "print('edited')");
  assert.deepEqual(restoreBlocks(converted), script);
  assert.notEqual(converted.blocksBackup, script.workspace);
  assert.deepEqual(
    validateDocument(JSON.parse(JSON.stringify({ ...doc, script: converted }))).script,
    converted,
  );
});
test("unsupported document versions and languages fail clearly", () => {
  assert.throws(() => validateDocument({ ...doc, version: 2 }), /Unsupported/);
  assert.throws(
    () => validateDocument({ ...doc, script: { language: "lua", source: "" } }),
    /Supported/,
  );
});
