// Applying remote ops to a live Blockly workspace without throwing the view away.
//
// The playground's only refresh path today is a full remount (`key={revision}` in App.tsx),
// which disposes and re-injects Blockly and so destroys scroll, zoom, selection and any drag
// in progress. That is fine for loading a document and unacceptable for a collaborator's
// keystroke, so every op here mutates in place.
//
// Correctness beats smoothness: if any op cannot be applied surgically we reload the whole
// workspace from the authoritative JSON and put the viewport back.

import * as Blockly from "blockly";
import type { BlockState, CollabOp, Connection } from "./types";

export interface ApplyResult {
  /** True when the surgical path handled every op. */
  targeted: boolean;
  /** Set when we fell back to a full reload, with the reason, for logging. */
  reason?: string;
}

interface Viewport {
  x: number;
  y: number;
  scale: number;
}

function captureViewport(workspace: Blockly.WorkspaceSvg): Viewport {
  return {
    x: workspace.scrollX,
    y: workspace.scrollY,
    scale: workspace.getScale(),
  };
}

function restoreViewport(workspace: Blockly.WorkspaceSvg, viewport: Viewport): void {
  try {
    workspace.setScale(viewport.scale);
    workspace.scroll(viewport.x, viewport.y);
  } catch {
    // A viewport we cannot restore is cosmetic; never let it mask a successful apply.
  }
}

function require(workspace: Blockly.WorkspaceSvg, id: string): Blockly.BlockSvg {
  const block = workspace.getBlockById(id);
  if (!block) throw new Error(`Block ${id} is not on this canvas.`);
  return block as Blockly.BlockSvg;
}

/** The parent connection an op names. */
function targetConnection(
  parent: Blockly.Block,
  slot: Connection,
): Blockly.Connection {
  if ("next" in slot) {
    if (!parent.nextConnection)
      throw new Error(`Block ${parent.id} has no next connection.`);
    return parent.nextConnection;
  }
  const input = parent.getInput(slot.input);
  if (!input?.connection)
    throw new Error(`Block ${parent.id} has no input ${slot.input}.`);
  return input.connection;
}

/** The child side that fits the given parent connection. */
function sourceConnection(
  block: Blockly.Block,
  target: Blockly.Connection,
): Blockly.Connection {
  const wantsValue = target.type === Blockly.ConnectionType.INPUT_VALUE;
  const source = wantsValue ? block.outputConnection : block.previousConnection;
  if (!source)
    throw new Error(
      `Block ${block.id} cannot connect to ${wantsValue ? "a value" : "a statement"} input.`,
    );
  return source;
}

/** Our BlockState is structurally Blockly's serialization State; both require `type`. */
function asBlockState(block: BlockState): Blockly.serialization.blocks.State {
  return block as unknown as Blockly.serialization.blocks.State;
}

function place(block: Blockly.BlockSvg, x: number, y: number): void {
  const current = block.getRelativeToSurfaceXY();
  block.moveBy(x - current.x, y - current.y);
}

function applyOne(workspace: Blockly.WorkspaceSvg, op: CollabOp): void {
  switch (op.op) {
    case "create": {
      const block = Blockly.serialization.blocks.append(
        asBlockState(op.block),
        workspace,
      ) as Blockly.BlockSvg;
      place(block, op.x, op.y);
      return;
    }
    case "replace": {
      // Rebuild the subtree from the replacement, then put it back where the old one was.
      const old = require(workspace, op.id);
      const parent = old.getParent();
      const target = old.outputConnection?.targetConnection ?? old.previousConnection?.targetConnection;
      const at = old.getRelativeToSurfaceXY();
      old.dispose(false);
      const block = Blockly.serialization.blocks.append(
        asBlockState(op.block),
        workspace,
      ) as Blockly.BlockSvg;
      if (parent && target) sourceConnection(block, target).connect(target);
      else place(block, at.x, at.y);
      return;
    }
    case "attach": {
      const block = require(workspace, op.id);
      const parent = require(workspace, op.parent);
      if (block.getParent()) block.unplug(false);
      const target = targetConnection(parent, op.connection);
      sourceConnection(block, target).connect(target);
      return;
    }
    case "detach": {
      const block = require(workspace, op.id);
      if (block.getParent()) block.unplug(false);
      place(block, op.x, op.y);
      return;
    }
    case "move":
      place(require(workspace, op.id), op.x, op.y);
      return;
    case "delete":
      // healStack false: the op stream already describes where survivors went.
      require(workspace, op.id).dispose(false);
      return;
    case "var_set": {
      // Blockly 13 keeps variables on the workspace's variable map, not the workspace.
      const variables = workspace.getVariableMap();
      const existing = variables.getVariableById(op.id);
      if (existing) variables.renameVariable(existing, op.name);
      else variables.createVariable(op.name, "", op.id);
      return;
    }
    case "var_delete": {
      const variables = workspace.getVariableMap();
      const existing = variables.getVariableById(op.id);
      if (existing) variables.deleteVariable(existing);
      return;
    }
    case "project":
      // Entities live outside the workspace; App.tsx handles this one.
      return;
    default: {
      const unknown = op as { op: string };
      throw new Error(`Unknown op ${unknown.op}.`);
    }
  }
}

/**
 * Apply remote ops in place.
 *
 * `authoritative` is the post-apply workspace JSON the caller already computed with
 * applyOps(). It is only read if the surgical path fails, and it is what guarantees the
 * canvas can always be brought back into agreement with the server.
 *
 * Events stay disabled throughout so the workspace's own change listener does not treat a
 * remote edit as a local one. The outbound path is a diff against the last acknowledged
 * state, so even if an event did escape, the next diff would be empty.
 */
export function applyRemoteOps(
  workspace: Blockly.WorkspaceSvg,
  ops: CollabOp[],
  authoritative: object,
): ApplyResult {
  const viewport = captureViewport(workspace);
  const group = Blockly.utils.idGenerator.genUid();
  Blockly.Events.disable();
  Blockly.Events.setGroup(group);
  try {
    for (const op of ops) applyOne(workspace, op);
    return { targeted: true };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    try {
      workspace.clear();
      Blockly.serialization.workspaces.load(authoritative, workspace);
      restoreViewport(workspace, viewport);
      return { targeted: false, reason };
    } catch (fatal) {
      return {
        targeted: false,
        reason: `${reason}; reload also failed: ${
          fatal instanceof Error ? fatal.message : String(fatal)
        }`,
      };
    }
  } finally {
    Blockly.Events.setGroup(false);
    Blockly.Events.enable();
  }
}

/** Load a whole document into the canvas, keeping the viewport. Used on snapshot and resync. */
export function loadWorkspace(
  workspace: Blockly.WorkspaceSvg,
  state: object,
  keepViewport = true,
): void {
  const viewport = captureViewport(workspace);
  Blockly.Events.disable();
  try {
    workspace.clear();
    Blockly.serialization.workspaces.load(state, workspace);
  } finally {
    Blockly.Events.enable();
  }
  if (keepViewport) restoreViewport(workspace, viewport);
}

const LOCKED_CLASS = "bark-locked";

/**
 * Make blocks somebody else owns physically undraggable.
 *
 * This is the real enforcement: Blockly refuses to start a gesture on an immovable block, so
 * a collaborator cannot begin dragging a subtree another person holds. The server's rejection
 * is the backstop, not the mechanism.
 */
export function applyLockStyling(
  workspace: Blockly.WorkspaceSvg,
  blocked: Set<string>,
  ownerOf: (blockId: string) => string | undefined,
): void {
  Blockly.Events.disable();
  try {
    for (const block of workspace.getAllBlocks(false)) {
      const locked = blocked.has(block.id);
      const svg = (block as Blockly.BlockSvg).getSvgRoot?.();
      if (locked) {
        block.setMovable(false);
        block.setEditable(false);
        block.setDeletable(false);
        svg?.classList.add(LOCKED_CLASS);
        const owner = ownerOf(block.id);
        if (owner) block.setTooltip(`${owner} is editing this`);
      } else if (svg?.classList.contains(LOCKED_CLASS)) {
        // Only restore blocks we took away, so we never override a block that the document
        // itself declares immovable.
        block.setMovable(true);
        block.setEditable(true);
        block.setDeletable(true);
        svg.classList.remove(LOCKED_CLASS);
        block.setTooltip("");
      }
    }
  } finally {
    Blockly.Events.enable();
  }
}

/** The subtree a gesture is about to move, so the client can lock it before the drag starts. */
export function gestureRoot(block: Blockly.Block): string {
  return block.id;
}

/** True while the user is mid-gesture, which is when remote ops must be queued, not applied. */
export function isDragging(workspace: Blockly.WorkspaceSvg): boolean {
  return workspace.isDragging();
}

/** Abort a gesture before touching the workspace. Last resort when a lock is lost mid-drag. */
export function cancelGesture(workspace: Blockly.WorkspaceSvg): void {
  try {
    workspace.cancelCurrentGesture();
  } catch {
    // Nothing in flight, or a Blockly version without it: either way there is nothing to undo.
  }
}
