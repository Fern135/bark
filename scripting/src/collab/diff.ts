// Deriving ops from two workspace snapshots, and the canonical hash both sides agree on.
//
// Ops come from a structural diff rather than from translating Blockly events: the editor
// already re-serialises the whole workspace on every change (playground/Editors.tsx), so
// diffing two plain JSON snapshots is deterministic, testable without Blockly, and immune to
// Blockly event-semantics drift. It also kills echo loops structurally - after applying a
// remote patch the caller sets its baseline to the post-apply JSON, so the next diff is empty.

import { ancestors, buildIndex, children, roots, workspaceOf } from "./ops";
import type {
  BlockState,
  CollabOp,
  Connection,
  VariableState,
  WorkspaceState,
} from "./types";

interface Placement {
  block: BlockState;
  parent: string | null;
  slot: Connection | null;
  depth: number;
  x: number;
  y: number;
}

function sameSlot(a: Connection | null, b: Connection | null): boolean {
  if (a === null || b === null) return a === b;
  if ("next" in a) return "next" in b;
  return "input" in b && a.input === b.input;
}

/** Every real block with where it sits. Shadows are content, so they never appear here. */
function placements(workspace: WorkspaceState): Map<string, Placement> {
  const found = new Map<string, Placement>();
  const walk = (
    block: BlockState,
    parent: string | null,
    slot: Connection | null,
    depth: number,
  ): void => {
    const id = typeof block.id === "string" ? block.id : undefined;
    if (id)
      found.set(id, {
        block,
        parent,
        slot,
        depth,
        x: Math.round(Number(block.x) || 0),
        y: Math.round(Number(block.y) || 0),
      });
    const owner = id ?? parent;
    if (block.inputs)
      for (const [name, holder] of Object.entries(block.inputs))
        if (holder?.block) walk(holder.block, owner, { input: name }, depth + 1);
    if (block.next?.block) walk(block.next.block, owner, { next: true }, depth + 1);
  };
  for (const root of roots(workspace)) if (root) walk(root, null, null, 0);
  return found;
}

/** A block's own content: type, fields, extraState, flags and shadows - never its children.
 *  Comparing this is what tells a content edit apart from a structural one. */
function own(block: BlockState): unknown {
  const { inputs, next, x, y, ...rest } = block;
  const kept: Record<string, unknown> = { ...rest };
  if (inputs) {
    const shadows: Record<string, unknown> = {};
    for (const [name, holder] of Object.entries(inputs))
      if (holder?.shadow) shadows[name] = holder.shadow;
    if (Object.keys(shadows).length) kept.inputs = shadows;
  }
  if (next?.shadow) kept.next = { shadow: next.shadow };
  return kept;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** A new subtree to send, with any descendant that already exists elsewhere stripped out.
 *  Those keep their identity and are re-attached by the attach phase instead, so no id is
 *  ever created twice. */
function pruned(block: BlockState, existing: Map<string, Placement>): BlockState {
  const copy = clone(block);
  const stack = [copy];
  while (stack.length) {
    const node = stack.pop()!;
    if (node.inputs)
      for (const holder of Object.values(node.inputs)) {
        const child = holder?.block;
        if (!child) continue;
        if (typeof child.id === "string" && existing.has(child.id)) delete holder.block;
        else stack.push(child);
      }
    const following = node.next?.block;
    if (following) {
      if (typeof following.id === "string" && existing.has(following.id))
        delete node.next!.block;
      else stack.push(following);
    }
  }
  return copy;
}

function variablesOf(workspace: WorkspaceState): Map<string, VariableState> {
  const found = new Map<string, VariableState>();
  for (const variable of workspace.variables ?? [])
    if (variable && typeof variable.id === "string") found.set(variable.id, variable);
  return found;
}

/**
 * Ops that turn `before` into `after`.
 *
 * Phase order matters and is not arbitrary:
 *   detach -> delete -> create -> attach -> replace -> move -> variables
 *
 * Detaching first rescues a block that was dragged out of a subtree the same edit deletes;
 * if the delete ran first it would take that block with it. Detaching also frees every slot
 * before the attach phase, so two blocks can swap places without a transient collision.
 * Replace runs after the structure is already correct, which is what makes it safe to send a
 * whole subtree: every id it carries is already sitting where the replacement expects it.
 */
export function diffWorkspaces(
  before: WorkspaceState,
  after: WorkspaceState,
): CollabOp[] {
  const from = placements(before);
  const to = placements(after);
  const afterIndex = buildIndex(after);
  const beforeIndex = buildIndex(before);

  const detaches: CollabOp[] = [];
  const deletes: CollabOp[] = [];
  const creates: CollabOp[] = [];
  const attaches: { op: CollabOp; depth: number }[] = [];
  const moves: CollabOp[] = [];
  /** Ids whose final x/y is already correct from an earlier phase. */
  const positioned = new Set<string>();

  // --- detach: anything that leaves its parent, before anything else disturbs the tree ---
  const reparented: string[] = [];
  for (const [id, now] of to) {
    const was = from.get(id);
    if (!was) continue;
    if (was.parent === now.parent && sameSlot(was.slot, now.slot)) continue;
    reparented.push(id);
    if (was.parent !== null) {
      detaches.push({ op: "detach", id, x: now.x, y: now.y });
      if (now.parent === null) positioned.add(id);
    }
  }

  // --- delete: topmost removals only, since a delete takes the whole subtree ---
  for (const id of from.keys()) {
    if (to.has(id)) continue;
    const covered = ancestors(beforeIndex, id).some((parent) => !from.get(parent) || !to.has(parent));
    if (!covered) deletes.push({ op: "delete", id });
  }

  // --- create: topmost new subtrees, pruned of blocks that already exist ---
  const created: string[] = [];
  for (const [id, now] of to) {
    if (from.has(id)) continue;
    if (now.parent !== null && !from.has(now.parent)) continue; // inside another new subtree
    created.push(id);
    creates.push({ op: "create", block: pruned(now.block, from), x: now.x, y: now.y });
    if (now.parent === null) positioned.add(id);
  }

  // --- attach: parents before children, so the target always exists ---
  for (const id of [...created, ...reparented]) {
    const now = to.get(id)!;
    if (now.parent === null || !now.slot) continue;
    attaches.push({
      op: { op: "attach", id, parent: now.parent, connection: now.slot },
      depth: now.depth,
    });
  }
  attaches.sort((a, b) => a.depth - b.depth);

  // --- replace: content changes, pruned so an ancestor's replace covers its descendants ---
  const changed = new Set<string>();
  for (const [id, now] of to) {
    const was = from.get(id);
    if (!was) continue;
    if (JSON.stringify(own(was.block)) !== JSON.stringify(own(now.block))) changed.add(id);
  }
  const replaces: CollabOp[] = [];
  for (const id of changed) {
    if (ancestors(afterIndex, id).some((parent) => changed.has(parent))) continue;
    replaces.push({ op: "replace", id, block: clone(to.get(id)!.block) });
    if (to.get(id)!.parent === null) positioned.add(id);
  }

  // --- move: roots that only slid across the canvas ---
  for (const [id, now] of to) {
    const was = from.get(id);
    if (!was || now.parent !== null || positioned.has(id)) continue;
    if (was.x !== now.x || was.y !== now.y) moves.push({ op: "move", id, x: now.x, y: now.y });
  }

  // --- variables ---
  const variables: CollabOp[] = [];
  const oldVars = variablesOf(before);
  const newVars = variablesOf(after);
  for (const [id, variable] of newVars) {
    const existing = oldVars.get(id);
    if (!existing || existing.name !== variable.name)
      variables.push({ op: "var_set", id, name: variable.name });
  }
  for (const id of oldVars.keys())
    if (!newVars.has(id)) variables.push({ op: "var_delete", id });

  return [
    ...detaches,
    ...deletes,
    ...creates,
    ...attaches.map((entry) => entry.op),
    ...replaces,
    ...moves,
    ...variables,
  ];
}

/**
 * JSON with object keys sorted and no incidental whitespace.
 *
 * Must match Python's `ops.canonical`, which is
 * `json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)`, or the two
 * sides' hashes disagree and every commit looks like divergence. Two known limits, neither
 * reachable from Blockly output: Python sorts keys by code point where JS sorts by UTF-16
 * code unit (differs only for astral-plane keys), and Python would render a float 1.0 as
 * "1.0" where JS renders 1 - which is why x/y are rounded to integers before they are sent.
 */
export function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") {
    const encoded = JSON.stringify(value);
    return encoded === undefined ? "null" : encoded;
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const record = value as Record<string, unknown>;
  const body = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
    .join(",");
  return `{${body}}`;
}

/** sha256 of the canonical workspace. Compared against the server's `patch.hash` to catch
 *  divergence; a mismatch means re-joining for a fresh snapshot. */
export async function hashWorkspace(document: unknown): Promise<string> {
  let workspace: unknown;
  try {
    workspace = workspaceOf(document);
  } catch {
    workspace = {};
  }
  const bytes = new TextEncoder().encode(canonical(workspace));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** Blocks under another connection's lock, for greying out the editor. */
export function lockedBlocks(
  workspace: WorkspaceState,
  locks: { blockId: string; conn: string }[],
  ownConn: string | undefined,
): Set<string> {
  const held = locks.filter((lock) => lock.conn !== ownConn);
  if (!held.length) return new Set();
  const index = buildIndex(workspace);
  const blocked = new Set<string>();
  for (const lock of held) {
    if (lock.blockId === "*") return new Set(index.keys());
    blocked.add(lock.blockId);
    const stack = [lock.blockId];
    // A lock covers its whole subtree, so every descendant is blocked too.
    while (stack.length) {
      const id = stack.pop()!;
      for (const [childId, node] of index)
        if (node.parent === id && !blocked.has(childId)) {
          blocked.add(childId);
          stack.push(childId);
        }
    }
  }
  return blocked;
}

export { children, workspaceOf };
