// Document algebra: apply ops, index blocks, decide lock conflicts.
//
// This is the TypeScript mirror of ws/app/collab/ops.py. The two implement the same algebra
// and must stay in lockstep: the server applies ops to decide what is true, the client
// applies the same ops to stay in agreement. When you change one, change both, and keep
// test/collab-ops.test.ts and ws/tests/test_ops.py in step.
//
// Shadow blocks are treated as content of their parent, never as identities of their own,
// so they are invisible to the index and can only change via a `replace`.

import { DOC_LOCK } from "./types";
import type {
  BlockNode,
  BlockState,
  CollabErrorCode,
  CollabOp,
  Connection,
  ConnectionState,
  WorkspaceState,
} from "./types";

export class CollabOpError extends Error {
  constructor(
    readonly code: CollabErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "CollabOpError";
  }
}

/** The workspace inside a GameDocument. Python scripts collaborate on their blocksBackup. */
export function workspaceOf(document: unknown): WorkspaceState {
  const doc = document as { script?: Record<string, unknown> };
  const script = doc?.script;
  if (!script || typeof script !== "object")
    throw new CollabOpError("INVALID_OP", "This document has no script.");
  if (script.language === "blocks") {
    if (!script.workspace || typeof script.workspace !== "object")
      script.workspace = { blocks: { languageVersion: 0, blocks: [] } };
    return script.workspace as WorkspaceState;
  }
  const backup = script.blocksBackup;
  if (!backup || typeof backup !== "object")
    throw new CollabOpError(
      "INVALID_OP",
      "This document has no block workspace to edit.",
    );
  return backup as WorkspaceState;
}

export function roots(workspace: WorkspaceState): BlockState[] {
  const blocks = (workspace.blocks ??= { languageVersion: 0, blocks: [] });
  const list = (blocks.blocks ??= []);
  if (!Array.isArray(list))
    throw new CollabOpError("INVALID_OP", "workspace.blocks.blocks must be a list.");
  return list;
}

export interface Child {
  holder: ConnectionState;
  child: BlockState;
  slot: Connection;
}
/** Every real (non-shadow) child, with the holder and slot so a caller can rewrite it. */
export function children(block: BlockState): Child[] {
  const found: Child[] = [];
  if (block.inputs)
    for (const [name, holder] of Object.entries(block.inputs))
      if (holder?.block) found.push({ holder, child: holder.block, slot: { input: name } });
  if (block.next?.block)
    found.push({ holder: block.next, child: block.next.block, slot: { next: true } });
  return found;
}

/** Drop a connection that holds nothing at all.
 *
 *  Blockly's own serializer omits empty slots, so leaving `{"next": {}}` behind would make an
 *  applied-op document and a freshly re-serialised one hash differently - which the server
 *  would read as divergence on every single commit. ws/app/collab/ops.py does the same. */
function pruneSlot(parent: BlockState, slot: Connection): void {
  if ("next" in slot) {
    if (parent.next && !parent.next.block && !parent.next.shadow) delete parent.next;
    return;
  }
  const holder = parent.inputs?.[slot.input];
  if (holder && !holder.block && !holder.shadow) delete parent.inputs![slot.input];
  if (parent.inputs && !Object.keys(parent.inputs).length) delete parent.inputs;
}

export function buildIndex(workspace: WorkspaceState): Map<string, BlockNode> {
  const index = new Map<string, BlockNode>();
  const stack: [BlockState, string | null, number][] = roots(workspace)
    .filter((root) => !!root)
    .map((root) => [root, null, 0]);
  while (stack.length) {
    const [block, parent, depth] = stack.pop()!;
    // An id-less block (hand-authored fixtures do this) cannot be addressed by an op, but
    // its children still might be, so keep walking under the same parent.
    const id = typeof block.id === "string" ? block.id : undefined;
    if (id) index.set(id, { id, parent, depth });
    for (const { child } of children(block)) stack.push([child, id ?? parent, depth + 1]);
  }
  return index;
}

/** Ids from this block's parent up to its root. Cycle-safe. */
export function ancestors(index: Map<string, BlockNode>, id: string): string[] {
  const chain: string[] = [];
  const seen = new Set([id]);
  let node = index.get(id);
  while (node?.parent && !seen.has(node.parent)) {
    chain.push(node.parent);
    seen.add(node.parent);
    node = index.get(node.parent);
  }
  return chain;
}

/** A lock covers its whole subtree, so two locks conflict when either contains the other. */
export function conflicts(
  index: Map<string, BlockNode>,
  requested: string,
  held: string,
): boolean {
  if (requested === held || requested === DOC_LOCK || held === DOC_LOCK) return true;
  return (
    ancestors(index, requested).includes(held) ||
    ancestors(index, held).includes(requested)
  );
}

export type Located =
  | { container: BlockState[]; position: number; block: BlockState }
  | {
      holder: ConnectionState;
      block: BlockState;
      parent: BlockState;
      slot: Connection;
    };

export function find(workspace: WorkspaceState, id: string): Located | undefined {
  const list = roots(workspace);
  for (let position = 0; position < list.length; position++) {
    if (list[position]?.id === id)
      return { container: list, position, block: list[position] };
  }
  const stack = list.filter((root) => !!root);
  while (stack.length) {
    const parent = stack.pop()!;
    for (const { holder, child, slot } of children(parent)) {
      if (child.id === id) return { holder, block: child, parent, slot };
      stack.push(child);
    }
  }
  return undefined;
}

export function isRoot(located: Located): boolean {
  return "container" in located;
}

/** Detach a block from wherever it sits and return it. */
function take(workspace: WorkspaceState, id: string): BlockState {
  const located = find(workspace, id);
  if (!located)
    throw new CollabOpError("NOT_FOUND", `Block "${id}" is not in this document.`);
  if ("container" in located) located.container.splice(located.position, 1);
  else {
    delete located.holder.block;
    pruneSlot(located.parent, located.slot);
  }
  return located.block;
}

export function subtreeIds(workspace: WorkspaceState, id: string): Set<string> {
  const located = find(workspace, id);
  const ids = new Set<string>();
  if (!located) return ids;
  const stack = [located.block];
  while (stack.length) {
    const block = stack.pop()!;
    if (typeof block.id === "string") ids.add(block.id);
    for (const { child } of children(block)) stack.push(child);
  }
  return ids;
}

/** The block whose lock the sender must hold, or undefined when the op needs none. */
export function primary(op: CollabOp): string | undefined {
  switch (op.op) {
    case "replace":
    case "attach":
    case "detach":
    case "move":
    case "delete":
      return op.id;
    case "project":
      return DOC_LOCK;
    default:
      return undefined;
  }
}

/** Every block an op reads or writes, for the "nobody else owns it" check. */
export function touched(op: CollabOp): string[] {
  const ids: string[] = [];
  const first = primary(op);
  if (first) ids.push(first);
  if (op.op === "attach") ids.push(op.parent);
  return ids;
}

function position(block: BlockState, x: unknown, y: unknown): void {
  // Rounded because the server stores these as integers; an un-rounded value would make the
  // two sides' canonical hashes disagree forever.
  block.x = Math.round(Number(x) || 0);
  block.y = Math.round(Number(y) || 0);
}

export function applyOp(document: unknown, op: CollabOp): void {
  const doc = document as Record<string, unknown>;
  if (op.op === "project") {
    doc.project = op.project;
    return;
  }

  const workspace = workspaceOf(document);

  switch (op.op) {
    case "create": {
      if (!op.block || typeof op.block.id !== "string")
        throw new CollabOpError("INVALID_OP", "create needs a block with an id.");
      if (find(workspace, op.block.id))
        throw new CollabOpError("INVALID_OP", `Block "${op.block.id}" already exists.`);
      const block = op.block;
      position(block, op.x, op.y);
      roots(workspace).push(block);
      return;
    }
    case "replace": {
      const located = find(workspace, op.id);
      if (!located)
        throw new CollabOpError("NOT_FOUND", `Block "${op.id}" is not in this document.`);
      const block: BlockState = { ...op.block, id: op.id };
      if ("container" in located) {
        // Roots keep their canvas position unless the replacement carries one.
        block.x ??= located.block.x ?? 0;
        block.y ??= located.block.y ?? 0;
        located.container[located.position] = block;
      } else {
        delete block.x;
        delete block.y;
        located.holder.block = block;
      }
      return;
    }
    case "attach": {
      if (op.parent === op.id || subtreeIds(workspace, op.id).has(op.parent))
        throw new CollabOpError("INVALID_OP", "A block cannot be attached inside itself.");
      const parentAt = find(workspace, op.parent);
      if (!parentAt)
        throw new CollabOpError(
          "NOT_FOUND",
          `Parent "${op.parent}" is not in this document.`,
        );
      const parent = parentAt.block;
      const toNext = "next" in op.connection && op.connection.next === true;
      const name = "input" in op.connection ? op.connection.input : undefined;
      if (!toNext && typeof name !== "string")
        throw new CollabOpError(
          "INVALID_OP",
          "attach needs connection.input or connection.next.",
        );
      // Resolve and check the target slot *before* detaching anything: taking the block
      // first would lose it entirely if the slot turned out to be occupied.
      const existing = toNext ? parent.next : parent.inputs?.[name!];
      const occupant = existing?.block;
      if (occupant) {
        if (occupant.id === op.id) return; // already attached exactly here
        throw new CollabOpError("INVALID_OP", "Target connection is already occupied.");
      }
      const block = take(workspace, op.id);
      delete block.x;
      delete block.y;
      if (toNext) (parent.next ??= {}).block = block;
      else ((parent.inputs ??= {})[name!] ??= {}).block = block;
      return;
    }
    case "detach": {
      const block = take(workspace, op.id);
      position(block, op.x, op.y);
      roots(workspace).push(block);
      return;
    }
    case "move": {
      const located = find(workspace, op.id);
      if (!located)
        throw new CollabOpError("NOT_FOUND", `Block "${op.id}" is not in this document.`);
      if (!("container" in located))
        throw new CollabOpError(
          "INVALID_OP",
          "move only repositions a root block; use attach/detach.",
        );
      position(located.block, op.x, op.y);
      return;
    }
    case "delete":
      take(workspace, op.id);
      return;
    case "var_set": {
      const variables = (workspace.variables ??= []);
      const existing = variables.find((variable) => variable?.id === op.id);
      if (existing) existing.name = op.name;
      else variables.push({ id: op.id, name: op.name });
      return;
    }
    case "var_delete":
      if (Array.isArray(workspace.variables))
        workspace.variables = workspace.variables.filter(
          (variable) => variable?.id !== op.id,
        );
      return;
    default: {
      const unknown = op as { op: string };
      throw new CollabOpError("INVALID_OP", `Unknown op "${unknown.op}".`);
    }
  }
}

/** Apply ops in order, mutating. Callers pass a clone and swap only on success. */
export function applyOps(document: unknown, ops: CollabOp[]): void {
  for (const op of ops) {
    if (!op || typeof op !== "object")
      throw new CollabOpError("INVALID_OP", "Each op must be an object.");
    applyOp(document, op);
  }
}
