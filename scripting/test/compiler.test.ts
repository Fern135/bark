import test from "node:test";
import assert from "node:assert/strict";
import {
  compileBlocks,
  setBlockChoices,
  validateBlockReferences,
} from "../src/blocks";
import {
  compilePython,
  convertToPython,
  restoreBlocks,
  validateDocument,
} from "../src/document";
import { sampleDocument, sampleWorkspace } from "../playground/sample";

const doc = sampleDocument();
setBlockChoices({
  entities: doc.project.entities.map((e) => [e.name, e.id]),
  prefabs: [["crate", "crate"]],
  actions: Object.keys(doc.project.input).map((a) => [a, a]),
});

test("missing saved references fail before dropdowns can retarget commands", () => {
  for (const [type, field] of [
    ["bark_entity", "ENTITY"],
    ["bark_touch", "ENTITY"],
    ["bark_interact", "ENTITY"],
    ["bark_input", "ACTION"],
    ["bark_input_event", "ACTION"],
    ["bark_spawn", "PREFAB"],
    ["bark_spawn_do", "PREFAB"],
  ]) {
    const invalid = {
      type,
      id: "missing-reference",
      fields: { [field]: "deleted-value" },
    };
    for (const branch of ["block", "shadow"]) {
      const workspace = {
        blocks: {
          languageVersion: 0,
          blocks: [
            {
              type: "bark_start",
              inputs: {
                DO: {
                  block: {
                    type: "bark_destroy",
                    inputs: { ENTITY: { [branch]: invalid } },
                  },
                },
              },
            },
          ],
        },
      };
      const before = structuredClone(workspace),
        compiled = compileBlocks({ language: "blocks", workspace });
      assert.equal(compiled.python, "");
      assert.equal(compiled.diagnostics[0].blockId, "missing-reference");
      assert.match(compiled.diagnostics[0].message, /deleted-value/);
      assert.deepEqual(workspace, before);
    }
  }
});

test("incoming project choices validate independently without changing the current choices", () => {
  const workspace = {
    blocks: {
      languageVersion: 0,
      blocks: [
        {
          type: "bark_start",
          inputs: {
            DO: {
              block: {
                type: "bark_destroy",
                inputs: {
                  ENTITY: {
                    block: {
                      type: "bark_entity",
                      fields: { ENTITY: "new-player" },
                    },
                  },
                },
              },
            },
          },
        },
      ],
    },
  };
  const available = {
    entities: [["New player", "new-player"] as [string, string]],
    prefabs: [],
    actions: [],
  };
  assert.deepEqual(validateBlockReferences(workspace, available), []);
  const compiled = compileBlocks({ language: "blocks", workspace }, available);
  assert.deepEqual(compiled.diagnostics, []);
  assert.match(compiled.python, /game.entity\("new-player"\)/);
  assert.ok(
    compileBlocks({ language: "blocks", workspace }).diagnostics.length,
  );
  const backup = {
    language: "python" as const,
    source: "pass",
    blocksBackup: workspace,
  };
  const restored = restoreBlocks(backup);
  assert.equal(restored.language, "blocks");
  assert.ok(validateBlockReferences(workspace).length);
  assert.deepEqual(backup.blocksBackup, workspace);
});
test("sample compiles shared variables, nested conditions, events, and cooperative loops", () => {
  const result = compileBlocks(doc.script);
  assert.deepEqual(result.diagnostics, []);
  assert.match(result.python, /global v_collected_0, v_cost_1/);
  assert.match(
    result.python,
    /async def fn_0\(p_0\):\n\s+global v_collected_0\n/,
  );
  assert.match(result.python, /await fn_0/);
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
          {
            type: "bark_start",
            inputs: { DO: { block: { type: "bark_destroy", id: "bad" } } },
          },
          { type: "math_number", id: "loose" },
        ],
      },
    },
  });
  assert.ok(
    bad.diagnostics.some(
      (d) => d.blockId === "bad" && d.message.includes("entity"),
    ),
  );
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
    validateDocument(JSON.parse(JSON.stringify({ ...doc, script: converted })))
      .script,
    converted,
  );
});
test("unsupported document versions and languages fail clearly", () => {
  assert.throws(() => validateDocument({ ...doc, version: 99 }), /Unsupported/);
  assert.throws(
    () => validateDocument({ ...doc, script: { language: "lua", source: "" } }),
    /Supported/,
  );
});

test("procedure diagnostics reject missing definitions, stale signatures and duplicates before Blockly repairs them", () => {
  const compile = (blocks: unknown[]) =>
    compileBlocks({
      language: "blocks",
      workspace: { blocks: { languageVersion: 0, blocks } },
    });
  const call = {
    type: "procedures_callnoreturn",
    id: "call",
    extraState: { name: "missing", params: [] },
  };
  assert.match(
    compile([{ type: "bark_start", inputs: { DO: { block: call } } }])
      .diagnostics[0].message,
    /Unknown function/,
  );
  const def = {
    type: "procedures_defnoreturn",
    fields: { NAME: "missing" },
    extraState: { params: [{ name: "arg", id: "arg" }] },
  };
  assert.match(
    compile([def, { type: "bark_start", inputs: { DO: { block: call } } }])
      .diagnostics[0].message,
    /requires 1/,
  );
  assert.match(compile([def, def]).diagnostics[0].message, /Duplicate/);
});

test("function parameters remain local and generated calls and returns retain block mappings", () => {
  const result = compileBlocks(doc.script);
  assert.deepEqual(result.diagnostics, []);
  const functionBody = result.python
    .split("async def fn_0(p_0):")[1]
    .split("@game.on_start")[0];
  assert.match(functionBody, />= p_0/);
  assert.doesNotMatch(functionBody, /global.*v_cost/);
  assert.match(functionBody, /await game.entity\("door"\).glide_to/);
  assert.match(functionBody, /return True/);
  assert.match(functionBody, /return False/);
  const lines = result.python.split("\n");
  for (const needle of [
    "return True",
    "return False",
    "await fn_0",
    "await game.broadcast",
    "await game.start_timer",
  ])
    assert.ok(
      result.sourceMap[lines.findIndex((l) => l.includes(needle)) + 1],
      needle,
    );
});
