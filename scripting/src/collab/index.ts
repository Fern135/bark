// Public surface of the collaboration client.
//
// Layering, innermost first:
//   types.ts         the wire contract, mirrored from ws/COLLAB-PROTOCOL.md
//   ops.ts           document algebra, mirrored from ws/app/collab/ops.py
//   diff.ts          ops derived from two snapshots, plus the canonical hash
//   client.ts        socket lifecycle, revisions, locks, recovery
//   blockly-apply.ts the only module that knows Blockly exists
//
// Everything except blockly-apply.ts is pure data, which is why it is all testable without a
// browser or a server.

export { createCollabClient, webSocketPort } from "./client";
export type {
  CollabClient,
  CollabClientOptions,
  CollabFailure,
  CollabStatus,
  PatchEvent,
  SnapshotEvent,
} from "./client";

export { canonical, diffWorkspaces, hashWorkspace, lockedBlocks } from "./diff";

export {
  CollabOpError,
  ancestors,
  applyOp,
  applyOps,
  buildIndex,
  conflicts,
  find,
  primary,
  subtreeIds,
  touched,
  workspaceOf,
} from "./ops";

export {
  applyLockStyling,
  applyRemoteOps,
  cancelGesture,
  isDragging,
  loadWorkspace,
} from "./blockly-apply";
export type { ApplyResult } from "./blockly-apply";

export { DOC_LOCK } from "./types";
export type {
  BlockNode,
  BlockState,
  CollabClientMessage,
  CollabErrorCode,
  CollabOp,
  CollabPort,
  CollabServerMessage,
  Connection,
  ConnectionState,
  LockRecord,
  Peer,
  VariableState,
  WorkspaceState,
} from "./types";
