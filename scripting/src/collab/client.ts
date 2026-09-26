// The collaboration client: socket lifecycle, revision bookkeeping and recovery.
//
// Everything that decides *what* changed lives in diff.ts and ops.ts, which are pure. This
// file owns the parts that involve time: one commit in flight, patches applied strictly in
// revision order, resync on a gap, reconnect with backoff, and a heartbeat that keeps this
// connection's lock alive.
//
// The transport is injected as a CollabPort, mirroring how session.ts injects a WorkerPort,
// so the whole state machine is testable with a fake and no server.

import { applyOps, CollabOpError, workspaceOf } from "./ops";
import { diffWorkspaces, hashWorkspace } from "./diff";
import type {
  CollabClientMessage,
  CollabOp,
  CollabPort,
  CollabServerMessage,
  LockRecord,
  Peer,
  WorkspaceState,
} from "./types";

export type CollabStatus =
  | "connecting"
  | "joining"
  | "ready"
  | "offline"
  | "error"
  | "disposed";

export interface SnapshotEvent {
  doc: string;
  rev: number;
  document: unknown;
  locks: LockRecord[];
  peers: Peer[];
  /** True when this replaced an existing document, i.e. the canvas must be rebuilt. */
  resync: boolean;
}
export interface PatchEvent {
  rev: number;
  ops: CollabOp[];
  by: string;
  /** The document after applying, so a listener can update state without re-deriving it. */
  document: unknown;
  /** False when this client produced the ops, so a listener can skip re-applying them. */
  remote: boolean;
}
export interface CollabFailure {
  code: string;
  message: string;
  /** Set when the client is recovering on its own and the UI need only inform the user. */
  recovering: boolean;
}

export interface CollabClient {
  readonly status: CollabStatus;
  readonly doc: string | undefined;
  readonly rev: number;
  readonly user: string | undefined;
  readonly ownConn: string | undefined;
  readonly locks: LockRecord[];
  readonly peers: Peer[];
  /** Offer the current document; the client diffs it against the last acknowledged state. */
  submit(document: unknown): void;
  lock(blockId: string): void;
  unlock(blockId: string): void;
  announce(blockId?: string): void;
  dispose(): void;
  onStatus(listener: (status: CollabStatus) => void): () => void;
  onSnapshot(listener: (event: SnapshotEvent) => void): () => void;
  onPatch(listener: (event: PatchEvent) => void): () => void;
  onLocks(listener: (locks: LockRecord[]) => void): () => void;
  onPeers(listener: (peers: Peer[]) => void): () => void;
  onFailure(listener: (failure: CollabFailure) => void): () => void;
}

export interface CollabClientOptions {
  /** A document uuid, or "new" to create one seeded from `document`. */
  doc: string;
  /** Required when doc === "new". */
  document?: unknown;
  /**
   * How to authenticate. "cookie" relies on the HttpOnly access_token the login sets, which
   * is the normal path; a token is only passed when there is no cookie (tests, tooling).
   * It matters which: the server reads the cookie *before* looking for an auth frame, so
   * sending a token when a cookie exists produces a stray frame the server rejects.
   */
  auth?: "cookie" | { token: string };
  createPort?: () => CollabPort;
  url?: string;
  heartbeatSeconds?: number;
  reconnectSeconds?: number;
  maxReconnectSeconds?: number;
  signal?: AbortSignal;
  /** Injected in tests so backoff does not make the suite slow. */
  setTimer?: (run: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

/** A CollabPort over a real WebSocket. The port owns JSON; the client owns protocol. */
export function webSocketPort(url: string): CollabPort {
  const socket = new WebSocket(url);
  const port: CollabPort = {
    send(message) {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
    },
    close() {
      try {
        socket.close();
      } catch {
        // Already closing; nothing to do.
      }
    },
    onopen: null,
    onmessage: null,
    onclose: null,
    onerror: null,
  };
  socket.onopen = () => port.onopen?.();
  socket.onclose = () => port.onclose?.();
  socket.onerror = () => port.onerror?.(new Error("Collaboration socket failed."));
  socket.onmessage = (event: MessageEvent<string>) => {
    let message: CollabServerMessage;
    try {
      message = JSON.parse(event.data) as CollabServerMessage;
    } catch {
      port.onerror?.(new Error("Collaboration socket sent malformed JSON."));
      return;
    }
    port.onmessage?.(message);
  };
  return port;
}

function defaultUrl(): string {
  const scheme = location.protocol === "https:" ? "wss" : "ws";
  return `${scheme}://${location.host}/ws/`;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Omit, distributed over a union. A plain Omit on a discriminated union keeps only the keys
 *  every member shares, which would erase every field the send helper needs to pass through. */
type Outbound<T> = T extends unknown ? Omit<T, "epoch"> : never;

interface Pending {
  nonce: number;
  ops: CollabOp[];
  /** The workspace these ops produce, which becomes the baseline once acknowledged. */
  workspace: WorkspaceState;
  generation: number;
  /** NOT_LOCKED is retried once, after taking the lock the server asked for. */
  retried: boolean;
}

export function createCollabClient(options: CollabClientOptions): CollabClient {
  const heartbeatMs = (options.heartbeatSeconds ?? 10) * 1000;
  const baseReconnect = (options.reconnectSeconds ?? 1) * 1000;
  const maxReconnect = (options.maxReconnectSeconds ?? 15) * 1000;
  const setTimer = options.setTimer ?? ((run, ms) => setTimeout(run, ms));
  const clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle as number));
  const createPort =
    options.createPort ?? (() => webSocketPort(options.url ?? defaultUrl()));

  const statusListeners = new Set<(status: CollabStatus) => void>();
  const snapshotListeners = new Set<(event: SnapshotEvent) => void>();
  const patchListeners = new Set<(event: PatchEvent) => void>();
  const lockListeners = new Set<(locks: LockRecord[]) => void>();
  const peerListeners = new Set<(peers: Peer[]) => void>();
  const failureListeners = new Set<(failure: CollabFailure) => void>();

  let port: CollabPort | undefined;
  let status: CollabStatus = "connecting";
  /** Bumped per socket. The port's own handlers guard on it, so a stale socket goes quiet. */
  let connection = 0;
  /**
   * Bumped per join attempt, and sent as `epoch`. Kept separate from `connection` on purpose:
   * a resync starts a new join on the *same* socket, and folding the two together made the
   * port's handlers reject every frame that arrived after a resync.
   */
  let generation = 0;
  let docId: string | undefined;
  let rev = -1;
  let user: string | undefined;
  let ownConn: string | undefined;
  let locks: LockRecord[] = [];
  let peers: Peer[] = [];
  /** Server-agreed document. */
  let document: unknown;
  /** Workspace of the last acknowledged state; every outbound diff is measured from here. */
  let baseline: WorkspaceState | undefined;
  /** The newest workspace the editor has offered, committed or not. */
  let local: WorkspaceState | undefined;
  let pending: Pending | undefined;
  let queued = false;
  let nonce = 0;
  let heartbeat: unknown;
  let reconnect: unknown;
  let attempts = 0;
  let held: string | undefined;

  function notify<T>(listeners: Set<(value: T) => void>, value: T): void {
    for (const listener of [...listeners]) {
      try {
        listener(value);
      } catch {
        // An observer that throws must not break delivery to the others, matching how
        // player-controller.ts isolates its listeners.
      }
    }
  }

  function setStatus(next: CollabStatus): void {
    if (status === next || status === "disposed") return;
    status = next;
    notify(statusListeners, status);
  }

  function fail(code: string, message: string, recovering: boolean): void {
    notify(failureListeners, { code, message, recovering });
  }

  function send(message: Outbound<CollabClientMessage>): void {
    port?.send({ ...message, epoch: generation } as CollabClientMessage);
  }

  function stopHeartbeat(): void {
    if (heartbeat !== undefined) {
      clearTimer(heartbeat);
      heartbeat = undefined;
    }
  }

  function startHeartbeat(): void {
    stopHeartbeat();
    const beat = (): void => {
      if (status === "disposed") return;
      // Only worth sending while we actually hold something worth renewing.
      if (held) send({ type: "heartbeat" });
      heartbeat = setTimer(beat, heartbeatMs);
    };
    heartbeat = setTimer(beat, heartbeatMs);
  }

  function connect(): void {
    if (status === "disposed") return;
    connection += 1;
    generation += 1;
    pending = undefined;
    queued = false;
    setStatus("connecting");
    const active = connection;
    const next = createPort();
    port = next;
    next.onopen = () => {
      if (active !== connection || status === "disposed") return;
      const auth = options.auth ?? "cookie";
      if (auth !== "cookie") send({ type: "auth", token: auth.token });
      // The server replies `ready` once authenticated; join waits for it so a rejected
      // token surfaces as a close rather than a confusing join error.
    };
    next.onmessage = (message) => {
      if (active !== connection || status === "disposed") return;
      receive(message);
    };
    next.onclose = () => {
      if (active !== connection || status === "disposed") return;
      setStatus("offline");
      stopHeartbeat();
      scheduleReconnect();
    };
    next.onerror = (error) => {
      if (active !== connection || status === "disposed") return;
      fail("SOCKET", error.message, true);
    };
  }

  function scheduleReconnect(): void {
    if (status === "disposed" || reconnect !== undefined) return;
    const delay = Math.min(maxReconnect, baseReconnect * 2 ** attempts);
    attempts += 1;
    reconnect = setTimer(() => {
      reconnect = undefined;
      connect();
    }, delay);
  }

  function join(): void {
    setStatus("joining");
    // `have` lets the server replay the ops we missed instead of resending the document.
    if (docId && rev >= 0) send({ type: "join", doc: docId, have: rev });
    else if (options.doc === "new")
      send({ type: "join", doc: "new", document: options.document });
    else send({ type: "join", doc: docId ?? options.doc });
  }

  /** Abandon local bookkeeping and ask for the truth again. */
  function resync(why: string): void {
    pending = undefined;
    queued = false;
    generation += 1;
    fail("RESYNC", why, true);
    join();
  }

  function verify(expected: string | null | undefined, applied: unknown): void {
    if (!expected) return;
    // Hashing is async, so it never blocks the apply path; a mismatch resyncs a moment later.
    void hashWorkspace(applied).then((actual) => {
      if (actual !== expected && status !== "disposed")
        resync("This copy drifted from the server's; reloading it.");
    });
  }

  function receive(message: CollabServerMessage): void {
    switch (message.type) {
      case "ready":
        user = message.user;
        attempts = 0;
        join();
        return;

      case "snapshot": {
        const replaced = document !== undefined;
        docId = message.doc;
        rev = message.rev;
        document = message.document;
        locks = message.locks ?? [];
        peers = message.peers ?? [];
        baseline = clone(workspaceOf(document));
        pending = undefined;
        queued = false;
        setStatus("ready");
        startHeartbeat();
        notify(snapshotListeners, {
          doc: docId,
          rev,
          document,
          locks,
          peers,
          resync: replaced,
        });
        notify(lockListeners, locks);
        notify(peerListeners, peers);
        // Local edits made while we were behind are re-derived against the new baseline.
        // Safe because a lock confines our edits to blocks nobody else can have touched.
        if (local) submitWorkspace(local);
        return;
      }

      case "patch": {
        if (rev < 0) return; // a patch queued ahead of our snapshot; it is already included
        if (message.rev <= rev) return; // ours, or already applied
        if (message.rev !== rev + 1) {
          resync(`Missed revision ${rev + 1}; reloading.`);
          return;
        }
        const candidate = clone(document);
        try {
          applyOps(candidate, message.ops);
        } catch (error) {
          resync(
            error instanceof CollabOpError
              ? `A collaborator's edit did not apply (${error.code}); reloading.`
              : "A collaborator's edit did not apply; reloading.",
          );
          return;
        }
        document = candidate;
        rev = message.rev;
        baseline = clone(workspaceOf(document));
        setStatus("ready");
        notify(patchListeners, {
          rev,
          ops: message.ops,
          by: message.by,
          document,
          remote: true,
        });
        verify(message.hash, document);
        if (local) submitWorkspace(local);
        return;
      }

      case "ack": {
        if (!pending || pending.nonce !== message.nonce) return;
        rev = message.rev;
        baseline = pending.workspace;
        const settled = pending;
        pending = undefined;
        // Our own work is already on the canvas; listeners are told so they can advance any
        // revision they display without re-applying anything.
        notify(patchListeners, {
          rev,
          ops: settled.ops,
          by: user ?? "",
          document,
          remote: false,
        });
        if (queued && local) {
          queued = false;
          submitWorkspace(local);
        }
        return;
      }

      case "lock_state": {
        if (message.nonce !== undefined && message.owner)
          ownConn = message.owner.conn;
        if (message.owner) {
          locks = [
            ...locks.filter((lock) => lock.blockId !== message.blockId),
            { blockId: message.blockId, user: message.owner.user, conn: message.owner.conn },
          ];
          if (message.owner.conn === ownConn) held = message.blockId;
        } else {
          locks = locks.filter((lock) => lock.blockId !== message.blockId);
          if (held === message.blockId) held = undefined;
        }
        notify(lockListeners, locks);
        return;
      }

      case "presence":
        peers = message.peers ?? [];
        notify(peerListeners, peers);
        return;

      case "error":
        handleError(message.code, message.message, message.rev);
        return;
    }
  }

  function handleError(code: string, message: string, serverRev?: number): void {
    switch (code) {
      case "REV_MISMATCH":
        if (typeof serverRev === "number" && serverRev !== rev) rev = serverRev;
        resync("Someone committed first; catching up.");
        return;
      case "NOT_LOCKED": {
        // Take the lock the server asked for, then retry the commit exactly once.
        const blocked = pending;
        pending = undefined;
        if (!blocked || blocked.retried || !local) {
          fail(code, message, false);
          return;
        }
        const target = firstPrimary(blocked.ops);
        if (target) lock(target);
        submitWorkspace(local, true);
        return;
      }
      case "LOCK_HELD":
      case "FORBIDDEN":
      case "NOT_FOUND":
        pending = undefined;
        fail(code, message, code === "NOT_FOUND");
        if (code === "NOT_FOUND") resync(message);
        return;
      case "LIMIT_EXCEEDED":
        // Drop this attempt; the next editor change will coalesce into a fresh one.
        pending = undefined;
        queued = true;
        fail(code, message, true);
        return;
      default:
        pending = undefined;
        fail(code, message, true);
        resync(message);
        return;
    }
  }

  function firstPrimary(ops: CollabOp[]): string | undefined {
    for (const op of ops) {
      if ("id" in op && typeof op.id === "string" && op.op !== "var_set" && op.op !== "var_delete")
        return op.id;
    }
    return undefined;
  }

  function submitWorkspace(workspace: WorkspaceState, retried = false): void {
    local = workspace;
    if (status !== "ready" || !baseline || !docId) return;
    if (pending) {
      // One commit in flight at a time, because `base` must equal the server's revision.
      // Later edits coalesce into the next one, as tick coalescing does in session.ts.
      queued = true;
      return;
    }
    const ops = diffWorkspaces(baseline, workspace);
    if (!ops.length) return;
    const committed = clone(workspace);
    const attempt: Pending = {
      nonce: (nonce += 1),
      ops,
      workspace: committed,
      generation,
      retried,
    };
    pending = attempt;
    // The document we hold must already reflect our own edit, or the next diff would
    // re-derive it: the editor is the source of truth for our side until the ack lands.
    const next = clone(document);
    try {
      const target = workspaceOf(next) as Record<string, unknown>;
      for (const key of Object.keys(target)) delete target[key];
      Object.assign(target, clone(committed));
      document = next;
    } catch {
      // A document without a block workspace cannot be collaborated on; the server will say so.
    }
    // Sent without a hash, deliberately. `hash` is optional on a commit, and computing one
    // means awaiting crypto.subtle on the path of every keystroke. Drift is still caught in
    // the direction that matters: the server puts its own hash on each patch, and `verify`
    // checks it there, where being asynchronous costs nothing.
    send({ type: "commit", base: rev, ops: attempt.ops, nonce: attempt.nonce });
  }

  function lock(blockId: string): void {
    if (status !== "ready") return;
    send({ type: "lock", blockId, nonce: (nonce += 1) });
  }

  function unlock(blockId: string): void {
    if (status !== "ready") return;
    if (held === blockId) held = undefined;
    send({ type: "unlock", blockId });
  }

  const client: CollabClient = {
    get status() {
      return status;
    },
    get doc() {
      return docId;
    },
    get rev() {
      return rev;
    },
    get user() {
      return user;
    },
    get ownConn() {
      return ownConn;
    },
    get locks() {
      return locks;
    },
    get peers() {
      return peers;
    },
    submit(next: unknown) {
      try {
        submitWorkspace(clone(workspaceOf(next)));
      } catch (error) {
        fail(
          error instanceof CollabOpError ? error.code : "INVALID_OP",
          error instanceof Error ? error.message : String(error),
          false,
        );
      }
    },
    lock,
    unlock,
    announce(blockId?: string) {
      if (status === "ready") send({ type: "presence", blockId });
    },
    dispose() {
      if (status === "disposed") return;
      setStatus("disposed");
      stopHeartbeat();
      if (reconnect !== undefined) {
        clearTimer(reconnect);
        reconnect = undefined;
      }
      connection += 1;
      generation += 1;
      port?.close();
      port = undefined;
      statusListeners.clear();
      snapshotListeners.clear();
      patchListeners.clear();
      lockListeners.clear();
      peerListeners.clear();
      failureListeners.clear();
    },
    onStatus(listener) {
      statusListeners.add(listener);
      return () => statusListeners.delete(listener);
    },
    onSnapshot(listener) {
      snapshotListeners.add(listener);
      return () => snapshotListeners.delete(listener);
    },
    onPatch(listener) {
      patchListeners.add(listener);
      return () => patchListeners.delete(listener);
    },
    onLocks(listener) {
      lockListeners.add(listener);
      return () => lockListeners.delete(listener);
    },
    onPeers(listener) {
      peerListeners.add(listener);
      return () => peerListeners.delete(listener);
    },
    onFailure(listener) {
      failureListeners.add(listener);
      return () => failureListeners.delete(listener);
    },
  };

  options.signal?.addEventListener("abort", () => client.dispose(), { once: true });
  connect();
  return client;
}
