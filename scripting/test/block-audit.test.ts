import test from "node:test";
import assert from "node:assert/strict";
import { exposedTypes, blockFixture, dropdownModes } from "./block-fixtures";
import { compileBlocks } from "../src/blocks";
import { choicesFor } from "../src/game-file";
import { sampleDocument } from "../playground/sample";

for (const type of exposedTypes) test(`block audit: ${type} and its dropdown modes compile`, () => {
  for (const override of [undefined, ...dropdownModes(type)]) {
    const { compilation } = blockFixture(type, override);
    assert.deepEqual(compilation.diagnostics, [], `${type} ${override}`);
    assert.ok(compilation.python.includes("PASS:"), type);
  }
});

test("missing required inputs produce block diagnostics throughout the library", () => {
  let checked = 0;
  for (const type of exposedTypes) {
    const { workspace } = blockFixture(type);
    const visit = (value: unknown): boolean => {
      if (!value || typeof value !== "object") return false;
      const block = value as { id?: string; inputs?: Record<string, unknown> };
      if (block.id === `audit-${type}`) {
        const key = Object.keys(block.inputs ?? {}).find((key) => !["DO", "DO0", "STACK"].includes(key));
        if (key) { delete block.inputs![key]; return true; }
      }
      return Object.values(value).some(visit);
    };
    if (!visit(workspace)) continue;
    const compiled = compileBlocks({ language: "blocks", workspace }, { ...choicesFor(sampleDocument().project), ownerId: "player" });
    assert.ok(compiled.diagnostics.some((d) => /Fill the/.test(d.message)), type);
    checked++;
  }
  assert.ok(checked > 50, `Checked ${checked} required-input cases`);
});
