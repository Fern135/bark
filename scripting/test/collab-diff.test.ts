import test from "node:test";
import assert from "node:assert/strict";
import { canonical, diffWorkspaces, hashWorkspace, lockedBlocks } from "../src/collab/diff";
import { applyOps, buildIndex, workspaceOf } from "../src/collab/ops";
import type { BlockState, VariableState, WorkspaceState } from "../src/collab/types";

const ws = (blocks: BlockState[], variables: VariableState[] = []): WorkspaceState => ({
  variables,
  blocks: { languageVersion: 0, blocks },
});
const doc = (workspace: WorkspaceState) => ({
  version: 1 as const,
  project: {},
  script: { language: "blocks" as const, workspace },
});

/** Root array order and variable order carry no meaning - position lives in x/y - so a
 *  comparison that respects them would fail for reasons the protocol does not care about. */
function normalized(workspace: WorkspaceState): unknown {
  const copy = JSON.parse(JSON.stringify(workspace)) as WorkspaceState;
  copy.blocks?.blocks?.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  copy.variables?.sort((a, b) => a.id.localeCompare(b.id));
  return copy;
}

/** before -> after pairs. Every one is checked for the round-trip property below. */
const cases: { name: string; before: WorkspaceState; after: WorkspaceState }[] = [
  {
    name: "a field edit",
    before: ws([{ type: "text", id: "t", x: 10, y: 10, fields: { TEXT: "before" } }]),
    after: ws([{ type: "text", id: "t", x: 10, y: 10, fields: { TEXT: "after" } }]),
  },
  {
    name: "a mutator changing extraState",
    before: ws([{ type: "controls_if", id: "if", x: 0, y: 0, extraState: { hasElse: false } }]),
    after: ws([{ type: "controls_if", id: "if", x: 0, y: 0, extraState: { hasElse: true } }]),
  },
  {
    name: "a list mutator growing its item count",
    before: ws([
      {
        type: "lists_create_with",
        id: "l",
        x: 0,
        y: 0,
        extraState: { itemCount: 1 },
        inputs: { ADD0: { block: { type: "text", id: "a" } } },
      },
    ]),
    after: ws([
      {
        type: "lists_create_with",
        id: "l",
        x: 0,
        y: 0,
        extraState: { itemCount: 2 },
        inputs: {
          ADD0: { block: { type: "text", id: "a" } },
          ADD1: { block: { type: "text", id: "b" } },
        },
      },
    ]),
  },
  {
    name: "a shadow appearing",
    before: ws([{ type: "bark_notify", id: "n", x: 0, y: 0, inputs: { TEXT: {} } }]),
    after: ws([
      {
        type: "bark_notify",
        id: "n",
        x: 0,
        y: 0,
        inputs: { TEXT: { shadow: { type: "text", id: "s", fields: { TEXT: "hi" } } } },
      },
    ]),
  },
  {
    // Blockly omits a slot that holds nothing, so the "after" side has no `inputs` at all.
    name: "a shadow disappearing",
    before: ws([
      { type: "bark_notify", id: "n", x: 0, y: 0, inputs: { TEXT: { shadow: { type: "text", id: "s" } } } },
    ]),
    after: ws([{ type: "bark_notify", id: "n", x: 0, y: 0 }]),
  },
  {
    name: "a root sliding across the canvas",
    before: ws([{ type: "text", id: "t", x: 10, y: 10 }]),
    after: ws([{ type: "text", id: "t", x: 250, y: 90 }]),
  },
  {
    name: "a subtree reparented to another stack",
    before: ws([
      {
        type: "bark_start",
        id: "start",
        x: 30,
        y: 30,
        inputs: { DO: { block: { type: "a", id: "n1", next: { block: { type: "b", id: "j1" } } } } },
      },
      { type: "bark_other", id: "other", x: 400, y: 30 },
    ]),
    after: ws([
      {
        type: "bark_start",
        id: "start",
        x: 30,
        y: 30,
        inputs: { DO: { block: { type: "a", id: "n1" } } },
      },
      { type: "bark_other", id: "other", x: 400, y: 30, next: { block: { type: "b", id: "j1" } } },
    ]),
  },
  {
    name: "a block dragged out to the canvas",
    before: ws([
      {
        type: "bark_start",
        id: "start",
        x: 0,
        y: 0,
        inputs: { DO: { block: { type: "a", id: "n1" } } },
      },
    ]),
    after: ws([
      { type: "bark_start", id: "start", x: 0, y: 0 },
      { type: "a", id: "n1", x: 120, y: 240 },
    ]),
  },
  {
    name: "two children swapping slots",
    before: ws([
      {
        type: "parent",
        id: "p",
        x: 0,
        y: 0,
        inputs: { A: { block: { type: "x", id: "one" } }, B: { block: { type: "y", id: "two" } } },
      },
    ]),
    after: ws([
      {
        type: "parent",
        id: "p",
        x: 0,
        y: 0,
        inputs: { A: { block: { type: "y", id: "two" } }, B: { block: { type: "x", id: "one" } } },
      },
    ]),
  },
  {
    name: "a new block from the flyout",
    before: ws([{ type: "text", id: "t", x: 0, y: 0 }]),
    after: ws([
      { type: "text", id: "t", x: 0, y: 0 },
      { type: "bark_jump", id: "fresh", x: 300, y: 300 },
    ]),
  },
  {
    name: "a new block created already connected",
    before: ws([{ type: "bark_start", id: "start", x: 0, y: 0 }]),
    after: ws([
      {
        type: "bark_start",
        id: "start",
        x: 0,
        y: 0,
        inputs: { DO: { block: { type: "a", id: "fresh" } } },
      },
    ]),
  },
  {
    name: "an existing block wrapped in a brand-new one",
    before: ws([
      {
        type: "bark_start",
        id: "start",
        x: 0,
        y: 0,
        inputs: { DO: { block: { type: "a", id: "n1" } } },
      },
    ]),
    after: ws([
      {
        type: "bark_start",
        id: "start",
        x: 0,
        y: 0,
        inputs: {
          DO: { block: { type: "wrapper", id: "wrap", inputs: { A: { block: { type: "a", id: "n1" } } } } },
        },
      },
    ]),
  },
  {
    name: "a deleted subtree",
    before: ws([
      {
        type: "bark_start",
        id: "start",
        x: 0,
        y: 0,
        inputs: { DO: { block: { type: "a", id: "n1", next: { block: { type: "b", id: "j1" } } } } },
      },
      { type: "keep", id: "keep", x: 400, y: 0 },
    ]),
    after: ws([{ type: "keep", id: "keep", x: 400, y: 0 }]),
  },
  {
    name: "a block rescued from a subtree that is deleted in the same edit",
    before: ws([
      {
        type: "bark_start",
        id: "start",
        x: 0,
        y: 0,
        inputs: { DO: { block: { type: "a", id: "n1", next: { block: { type: "b", id: "j1" } } } } },
      },
    ]),
    after: ws([{ type: "b", id: "j1", x: 500, y: 500 }]),
  },
  {
    name: "variables created, renamed and removed",
    before: ws([{ type: "text", id: "t", x: 0, y: 0 }], [
      { id: "v1", name: "score" },
      { id: "v2", name: "gone" },
    ]),
    after: ws([{ type: "text", id: "t", x: 0, y: 0 }], [
      { id: "v1", name: "points" },
      { id: "v3", name: "lives" },
    ]),
  },
  {
    name: "no change at all",
    before: ws([{ type: "text", id: "t", x: 0, y: 0 }], [{ id: "v1", name: "score" }]),
    after: ws([{ type: "text", id: "t", x: 0, y: 0 }], [{ id: "v1", name: "score" }]),
  },
];

test("every diff round-trips: applying it to `before` reproduces `after` exactly", () => {
  for (const { name, before, after } of cases) {
    const ops = diffWorkspaces(before, after);
    const candidate = doc(JSON.parse(JSON.stringify(before)));
    applyOps(candidate, ops);
    assert.deepEqual(
      normalized(workspaceOf(candidate) as WorkspaceState),
      normalized(after),
      `${name}: ops did not reproduce the target\n${JSON.stringify(ops, null, 1)}`,
    );
  }
});

test("a diff of identical workspaces is empty, which is what makes echo loops impossible", () => {
  const same = ws([{ type: "text", id: "t", x: 5, y: 5, fields: { TEXT: "hi" } }], [
    { id: "v1", name: "score" },
  ]);
  assert.deepEqual(diffWorkspaces(same, JSON.parse(JSON.stringify(same))), []);
});

test("a content edit is a single replace carrying the subtree", () => {
  const before = ws([{ type: "text", id: "t", x: 0, y: 0, fields: { TEXT: "a" } }]);
  const after = ws([{ type: "text", id: "t", x: 0, y: 0, fields: { TEXT: "b" } }]);
  const ops = diffWorkspaces(before, after);
  assert.equal(ops.length, 1);
  assert.equal(ops[0].op, "replace");
  assert.equal(ops[0].op === "replace" && ops[0].id, "t");
});

test("an ancestor's replace covers its descendants instead of emitting one each", () => {
  const before = ws([
    {
      type: "p",
      id: "p",
      x: 0,
      y: 0,
      fields: { A: 1 },
      inputs: { X: { block: { type: "c", id: "c", fields: { B: 1 } } } },
    },
  ]);
  const after = ws([
    {
      type: "p",
      id: "p",
      x: 0,
      y: 0,
      fields: { A: 2 },
      inputs: { X: { block: { type: "c", id: "c", fields: { B: 2 } } } },
    },
  ]);
  const ops = diffWorkspaces(before, after);
  assert.deepEqual(ops.map((op) => op.op), ["replace"]);
  assert.equal(ops[0].op === "replace" && ops[0].id, "p");
});

test("reparenting detaches before it attaches, so a slot is never transiently occupied", () => {
  const { before, after } = cases.find((entry) => entry.name === "two children swapping slots")!;
  const ops = diffWorkspaces(before, after);
  assert.deepEqual(ops.map((op) => op.op), ["detach", "detach", "attach", "attach"]);
});

test("a rescued block is detached before the delete that would have taken it", () => {
  const { before, after } = cases.find((entry) =>
    entry.name === "a block rescued from a subtree that is deleted in the same edit",
  )!;
  const ops = diffWorkspaces(before, after);
  const detach = ops.findIndex((op) => op.op === "detach" && op.id === "j1");
  const remove = ops.findIndex((op) => op.op === "delete");
  assert.ok(detach >= 0, "j1 must be detached rather than deleted with its parent");
  assert.ok(remove > detach, "the delete must come after the rescue");
});

test("a deleted subtree costs one delete, not one per block", () => {
  const { before, after } = cases.find((entry) => entry.name === "a deleted subtree")!;
  const ops = diffWorkspaces(before, after);
  assert.deepEqual(ops, [{ op: "delete", id: "start" }]);
});

test("wrapping an existing block creates the wrapper without duplicating the block's id", () => {
  const { before, after } = cases.find((entry) =>
    entry.name === "an existing block wrapped in a brand-new one",
  )!;
  const ops = diffWorkspaces(before, after);
  const create = ops.find((op) => op.op === "create");
  assert.ok(create && create.op === "create");
  const carried = buildIndex(ws([create.block]));
  assert.equal(carried.has("wrap"), true);
  assert.equal(carried.has("n1"), false, "an existing id must not be re-created inside a new subtree");
  // Parents attach before children, so the wrapper is in place before n1 goes into it.
  const attaches = ops.filter((op) => op.op === "attach");
  assert.deepEqual(
    attaches.map((op) => (op.op === "attach" ? op.id : "")),
    ["wrap", "n1"],
  );
});

test("a variable rename is keyed by id, never a delete plus a create", () => {
  const before = ws([], [{ id: "v1", name: "score" }]);
  const after = ws([], [{ id: "v1", name: "points" }]);
  assert.deepEqual(diffWorkspaces(before, after), [
    { op: "var_set", id: "v1", name: "points" },
  ]);
});

test("canonical JSON sorts keys, drops undefined, and stays compact", () => {
  assert.equal(canonical({ b: 1, a: 2 }), '{"a":2,"b":1}');
  assert.equal(canonical({ a: undefined, b: 1 }), '{"b":1}');
  assert.equal(canonical([1, "two", null, true]), '[1,"two",null,true]');
  assert.equal(canonical({}), "{}");
  assert.equal(canonical(undefined), "null");
});

test("the workspace hash matches the value the Python server computes for the same document", async () => {
  // Reference values produced by ws/app/collab/ops.py:workspace_hash. If this test fails the
  // two canonicalisations have drifted, and every commit will look like divergence.
  const workspace = {
    variables: [{ id: "v1", name: "scoré" }],
    blocks: {
      languageVersion: 0,
      blocks: [
        {
          type: "bark_start",
          id: "start",
          x: 30,
          y: 30,
          fields: {
            TEXT: 'héllo "world"\n\t',
            NUM: 1,
            FLAG: true,
            NOTHING: null,
            EMOJI: "\u{1f436}",
          },
          inputs: { DO: { shadow: { type: "text", id: "s1" } } },
          extraState: { itemCount: 2 },
        },
      ],
    },
  };
  assert.equal(
    await hashWorkspace(doc(workspace as WorkspaceState)),
    "54c0a7aad9a0add2ee4cd087ee62ac63b3c08d45be2fb6e672b6b1847002aef5",
  );
  assert.equal(
    await hashWorkspace(doc({} as WorkspaceState)),
    "44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a",
  );
  // Key order must not change the hash; content must.
  const reordered = doc({ blocks: { blocks: [], languageVersion: 0 } } as WorkspaceState);
  const ordered = doc({ blocks: { languageVersion: 0, blocks: [] } } as WorkspaceState);
  assert.equal(await hashWorkspace(reordered), await hashWorkspace(ordered));
  assert.notEqual(
    await hashWorkspace(ordered),
    await hashWorkspace(doc(ws([{ type: "text", id: "t", x: 0, y: 0 }]))),
  );
});

test("a foreign lock greys out its whole subtree, and the doc lock greys out everything", () => {
  const workspace = ws([
    {
      type: "bark_start",
      id: "start",
      x: 0,
      y: 0,
      inputs: { DO: { block: { type: "a", id: "n1", next: { block: { type: "b", id: "j1" } } } } },
    },
    { type: "loose", id: "loose", x: 400, y: 0 },
  ]);
  assert.deepEqual(
    [...lockedBlocks(workspace, [{ blockId: "start", conn: "them" }], "me")].sort(),
    ["j1", "n1", "start"],
  );
  // Your own lock never blocks you.
  assert.deepEqual([...lockedBlocks(workspace, [{ blockId: "start", conn: "me" }], "me")], []);
  assert.deepEqual(
    [...lockedBlocks(workspace, [{ blockId: "*", conn: "them" }], "me")].sort(),
    ["j1", "loose", "n1", "start"],
  );
});
