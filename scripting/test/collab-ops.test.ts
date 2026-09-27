import test from "node:test";
import assert from "node:assert/strict";
import {
  CollabOpError,
  ancestors,
  applyOp,
  applyOps,
  buildIndex,
  conflicts,
  find,
  primary,
  touched,
  workspaceOf,
} from "../src/collab/ops";
import { DOC_LOCK } from "../src/collab/types";
import type { WorkspaceState } from "../src/collab/types";

/** A workspace with a nested stack, an obscured shadow, and one loose root. */
function document() {
  return {
    version: 1 as const,
    project: { entities: [] },
    script: {
      language: "blocks" as const,
      workspace: {
        variables: [{ name: "score", id: "v1" }],
        blocks: {
          languageVersion: 0,
          blocks: [
            {
              type: "bark_start",
              id: "start",
              x: 30,
              y: 30,
              inputs: {
                DO: {
                  block: {
                    type: "bark_notify",
                    id: "n1",
                    inputs: {
                      TEXT: { shadow: { type: "text", id: "s1", fields: { TEXT: "hi" } } },
                    },
                    next: { block: { type: "bark_jump", id: "j1" } },
                  },
                },
              },
            },
            { type: "bark_loose", id: "loose", x: 500, y: 40 },
          ],
        },
      },
    },
  };
}

function caught(run: () => void): CollabOpError {
  try {
    run();
  } catch (error) {
    assert.ok(error instanceof CollabOpError, `expected CollabOpError, got ${error}`);
    return error;
  }
  assert.fail("expected an error");
}

test("the index covers every real block with its parent and depth, and skips shadows", () => {
  const index = buildIndex(workspaceOf(document()));
  assert.deepEqual([...index.keys()].sort(), ["j1", "loose", "n1", "start"]);
  // Shadows are default values, not identities, so no op can ever address one.
  assert.equal(index.has("s1"), false);
  assert.equal(index.get("start")!.parent, null);
  assert.equal(index.get("n1")!.parent, "start");
  assert.equal(index.get("j1")!.parent, "n1");
  assert.equal(index.get("j1")!.depth, 2);
  assert.deepEqual(ancestors(index, "j1"), ["n1", "start"]);
});

test("id-less blocks are skipped but their children stay reachable", () => {
  const workspace: WorkspaceState = {
    blocks: {
      languageVersion: 0,
      blocks: [{ type: "a", next: { block: { type: "b", id: "real" } } }],
    },
  };
  const index = buildIndex(workspace);
  assert.deepEqual([...index.keys()], ["real"]);
  assert.equal(index.get("real")!.parent, null);
});

test("a lock covers its subtree, conflicts in both directions, and the doc lock blocks all", () => {
  const index = buildIndex(workspaceOf(document()));
  assert.equal(conflicts(index, "n1", "n1"), true);
  assert.equal(conflicts(index, "j1", "start"), true, "ancestor lock covers a descendant");
  assert.equal(conflicts(index, "start", "j1"), true, "descendant lock blocks the ancestor");
  assert.equal(conflicts(index, "loose", "start"), false, "separate stacks are independent");
  assert.equal(conflicts(index, "loose", DOC_LOCK), true);
  assert.equal(conflicts(index, DOC_LOCK, "n1"), true);
});

test("a cyclic index cannot hang the lock check", () => {
  const index = new Map([
    ["a", { id: "a", parent: "b", depth: 1 }],
    ["b", { id: "b", parent: "a", depth: 1 }],
  ]);
  assert.equal(conflicts(index, "a", "b"), true);
});

test("move repositions a root and refuses a connected block", () => {
  const doc = document();
  const workspace = workspaceOf(doc);
  applyOp(doc, { op: "move", id: "loose", x: 11, y: 22 });
  assert.equal(find(workspace, "loose")!.block.x, 11);
  assert.equal(caught(() => applyOp(doc, { op: "move", id: "n1", x: 1, y: 2 })).code, "INVALID_OP");
});

test("detach makes a root and attach reconnects, clearing the canvas position", () => {
  const doc = document();
  const workspace = workspaceOf(doc);
  applyOp(doc, { op: "detach", id: "j1", x: 300, y: 300 });
  assert.equal(buildIndex(workspace).get("j1")!.parent, null);
  assert.equal(find(workspace, "n1")!.block.next?.block, undefined);

  applyOp(doc, { op: "attach", id: "j1", parent: "start", connection: { next: true } });
  assert.equal(buildIndex(workspace).get("j1")!.parent, "start");
  assert.equal("x" in find(workspace, "j1")!.block, false);
});

test("attach refuses cycles, refuses an occupied slot without losing the block, and is a no-op in place", () => {
  const doc = document();
  const workspace = workspaceOf(doc);
  assert.equal(
    caught(() =>
      applyOp(doc, { op: "attach", id: "start", parent: "n1", connection: { next: true } }),
    ).code,
    "INVALID_OP",
  );

  // Regression: the block used to be detached before the slot was checked, which lost it.
  const before = JSON.stringify(workspace);
  assert.equal(
    caught(() =>
      applyOp(doc, { op: "attach", id: "loose", parent: "start", connection: { input: "DO" } }),
    ).code,
    "INVALID_OP",
  );
  assert.ok(find(workspace, "loose"), "a rejected attach must not consume the block");
  assert.equal(JSON.stringify(workspace), before, "a rejected attach must change nothing");

  applyOp(doc, { op: "attach", id: "n1", parent: "start", connection: { input: "DO" } });
  assert.equal(JSON.stringify(workspace), before, "re-attaching in place is a no-op");
});

test("replace keeps identity, keeps a root's position, and overwrites the whole subtree", () => {
  const doc = document();
  const workspace = workspaceOf(doc);

  applyOp(doc, { op: "replace", id: "n1", block: { type: "bark_notify", x: 9, y: 9 } });
  const child = find(workspace, "n1")!.block;
  assert.equal(child.id, "n1");
  assert.equal("x" in child, false, "a connected block carries no canvas position");

  applyOp(doc, {
    op: "replace",
    id: "start",
    block: { type: "bark_start", extraState: { hasElse: true } },
  });
  const root = find(workspace, "start")!.block;
  assert.equal(root.id, "start");
  assert.equal(root.x, 30, "a root keeps its position unless the replacement carries one");
  assert.deepEqual(root.extraState, { hasElse: true });
  // By design: the client always sends the full subtree, and the lock it holds guarantees
  // nobody else was editing inside it. This is what buys the small op set.
  assert.equal(buildIndex(workspace).has("n1"), false);
});

test("create adds a root, rejects a duplicate id, and delete removes the whole subtree", () => {
  const doc = document();
  const workspace = workspaceOf(doc);
  applyOp(doc, { op: "create", block: { type: "bark_hud", id: "h1" }, x: 7, y: 8 });
  assert.equal(buildIndex(workspace).get("h1")!.parent, null);
  assert.equal(find(workspace, "h1")!.block.y, 8);
  assert.equal(
    caught(() => applyOp(doc, { op: "create", block: { type: "x", id: "loose" }, x: 0, y: 0 })).code,
    "INVALID_OP",
  );

  applyOp(doc, { op: "delete", id: "n1" });
  const index = buildIndex(workspace);
  assert.equal(index.has("n1"), false);
  assert.equal(index.has("j1"), false, "descendants go with the subtree");
  assert.equal(index.has("loose"), true);
});

test("a missing block is NOT_FOUND and an unknown op is INVALID_OP", () => {
  const doc = document();
  assert.equal(caught(() => applyOp(doc, { op: "delete", id: "ghost" })).code, "NOT_FOUND");
  assert.equal(
    caught(() => applyOp(doc, { op: "teleport", id: "n1" } as never)).code,
    "INVALID_OP",
  );
});

test("variables are keyed by id, so a rename is not a delete plus a create", () => {
  const doc = document();
  const workspace = workspaceOf(doc);
  applyOp(doc, { op: "var_set", id: "v1", name: "points" });
  assert.equal(workspace.variables![0].name, "points");
  applyOp(doc, { op: "var_set", id: "v2", name: "lives" });
  assert.equal(workspace.variables!.length, 2);
  applyOp(doc, { op: "var_delete", id: "v1" });
  assert.deepEqual(workspace.variables!.map((v) => v.id), ["v2"]);
});

test("primary names the block needing a lock and attach also touches its new parent", () => {
  assert.equal(primary({ op: "create", block: { type: "x", id: "a" }, x: 0, y: 0 }), undefined);
  assert.equal(primary({ op: "var_set", id: "v1", name: "x" }), undefined);
  assert.equal(primary({ op: "replace", id: "b7", block: { type: "x" } }), "b7");
  assert.equal(primary({ op: "delete", id: "b7" }), "b7");
  assert.equal(primary({ op: "project", project: {} }), DOC_LOCK);
  // So dropping a block into somebody else's stack is refused.
  assert.deepEqual(
    touched({ op: "attach", id: "b7", parent: "b2", connection: { next: true } }),
    ["b7", "b2"],
  );
});

test("the project op replaces the whole value and python documents use their blocks backup", () => {
  const doc = document();
  applyOp(doc, { op: "project", project: { entities: [{ id: "player" }] } });
  assert.deepEqual(doc.project, { entities: [{ id: "player" }] });

  const python = {
    script: {
      language: "python",
      source: "x = 1",
      blocksBackup: { blocks: { languageVersion: 0, blocks: [] } },
    },
  };
  assert.equal(workspaceOf(python), python.script.blocksBackup);
  assert.equal(
    caught(() => workspaceOf({ script: { language: "python", source: "x = 1" } })).code,
    "INVALID_OP",
  );
});

test("applyOps mutates, so a failing batch is why callers pass a clone", () => {
  const doc = document();
  const candidate = JSON.parse(JSON.stringify(doc));
  assert.throws(
    () =>
      applyOps(candidate, [
        { op: "move", id: "loose", x: 1, y: 1 },
        { op: "delete", id: "ghost" },
      ]),
    CollabOpError,
  );
  assert.equal(find(workspaceOf(doc), "loose")!.block.x, 500, "the original is untouched");
  assert.equal(find(workspaceOf(candidate), "loose")!.block.x, 1, "the clone absorbed it");
});
