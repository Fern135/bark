// Client side of the collaboration protocol. This file mirrors ws/COLLAB-PROTOCOL.md and
// ws/app/collab/protocol.py; the protocol document is the contract, so change it first.

/** One node of Blockly's workspace serialization. Children hang off `inputs` and `next`. */
export interface BlockState {
  type: string;
  id?: string;
  x?: number;
  y?: number;
  collapsed?: boolean;
  disabled?: boolean;
  disabledReasons?: string[];
  enabled?: boolean;
  deletable?: boolean;
  movable?: boolean;
  editable?: boolean;
  inline?: boolean;
  data?: string;
  extraState?: unknown;
  icons?: Record<string, unknown>;
  fields?: Record<string, unknown>;
  inputs?: Record<string, ConnectionState>;
  next?: ConnectionState;
}
/** A connection holds a real block, a shadow (default value), or both. */
export interface ConnectionState {
  block?: BlockState;
  shadow?: BlockState;
}
export interface VariableState {
  name: string;
  id: string;
  type?: string;
}
export interface WorkspaceState {
  variables?: VariableState[];
  blocks?: { languageVersion?: number; blocks?: BlockState[] };
}
/** Where a block sits. `parent` is null for a root. */
export interface BlockNode {
  id: string;
  parent: string | null;
  depth: number;
}
/** The document-level lock. Conflicts with every block; required by the `project` op. */
export const DOC_LOCK = "*";
export type Connection = { input: string } | { next: true };
export type CollabOp =
  | { op: "create"; block: BlockState; x: number; y: number }
  | { op: "replace"; id: string; block: BlockState }
  | { op: "attach"; id: string; parent: string; connection: Connection }
  | { op: "detach"; id: string; x: number; y: number }
  | { op: "move"; id: string; x: number; y: number }
  | { op: "delete"; id: string }
  | { op: "var_set"; id: string; name: string }
  | { op: "var_delete"; id: string }
  | { op: "project"; project: unknown };
export interface Peer {
  user: string;
  conn: string;
  blockId?: string | null;
}
export interface LockRecord {
  blockId: string;
  user: string;
  conn: string;
}
export type CollabErrorCode =
  | "REV_MISMATCH"
  | "LOCK_HELD"
  | "NOT_LOCKED"
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "LIMIT_EXCEEDED"
  | "INVALID_OP";
/** `epoch` is ours alone: the server echoes nothing, and we use it to drop our own stale
 *  traffic after a resync, exactly as `session` does in types.ts. */
export type CollabClientMessage = { epoch: number } & (
  | { type: "auth"; token: string }
  | { type: "join"; doc: string; have?: number; document?: unknown }
  | { type: "lock"; blockId: string; nonce: number }
  | { type: "unlock"; blockId: string }
  | {
      type: "commit";
      base: number;
      ops: CollabOp[];
      hash?: string;
      nonce: number;
    }
  | { type: "presence"; blockId?: string }
  | { type: "heartbeat" }
);
export type CollabServerMessage =
  | { type: "ready"; user: string }
  | {
      type: "snapshot";
      doc: string;
      rev: number;
      document: unknown;
      locks: LockRecord[];
      peers: Peer[];
    }
  | {
      type: "patch";
      rev: number;
      ops: CollabOp[];
      by: string;
      hash?: string | null;
    }
  | { type: "ack"; nonce: number; rev: number }
  | {
      type: "lock_state";
      blockId: string;
      owner: Peer | null;
      nonce?: number;
    }
  | { type: "presence"; peers: Peer[] }
  | { type: "error"; code: CollabErrorCode; message: string; rev?: number };
/** Transport seam, shaped like WorkerPort so a fake can stand in for a socket in tests.
 *  Messages are already decoded: the port owns JSON, the client owns protocol. */
export interface CollabPort {
  send(message: CollabClientMessage): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((message: CollabServerMessage) => void) | null;
  onclose: (() => void) | null;
  onerror: ((error: Error) => void) | null;
}
