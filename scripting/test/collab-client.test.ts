import test from "node:test";
import assert from "node:assert/strict";
import { createCollabClient } from "../src/collab/client";
import type { CollabClient, PatchEvent, SnapshotEvent } from "../src/collab/client";
import type { BlockState, CollabServerMessage } from "../src/collab/types";
import { FakeCollabPort } from "./fakes";

const DOC = "11111111-2222-3333-4444-555555555555";

function workspace(blocks: BlockState[]) {
  return { variables: [], blocks: { languageVersion: 0, blocks } };
}
function document(blocks: BlockState[]) {
  return {
    version: 1 as const,
    project: {},
    script: { language: "blocks" as const, workspace: workspace(blocks) },
  };
}
const one = () => document([{ type: "text", id: "t", x: 0, y: 0, fields: { TEXT: "a" } }]);
const two = () => document([{ type: "text", id: "t", x: 0, y: 0, fields: { TEXT: "b" } }]);

/** Snapshot hashing and patch verification are async, so let pending work drain. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

interface Harness {
  client: CollabClient;
  ports: FakeCollabPort[];
  port: () => FakeCollabPort;
  flushTimers: () => void;
  snapshots: SnapshotEvent[];
  patches: PatchEvent[];
  failures: { code: string; message: string; recovering: boolean }[];
  locks: unknown[][];
  /** Drive the usual opening handshake and land on `rev`. */
  ready: (rev?: number, doc?: ReturnType<typeof one>) => Promise<void>;
}

function harness(doc = DOC, seed?: unknown): Harness {
  const ports: FakeCollabPort[] = [];
  const timers: { run: () => void }[] = [];
  const snapshots: SnapshotEvent[] = [];
  const patches: PatchEvent[] = [];
  const failures: { code: string; message: string; recovering: boolean }[] = [];
  const locks: unknown[][] = [];
  const client = createCollabClient({
    doc,
    document: seed,
    createPort: () => {
      const port = new FakeCollabPort();
      ports.push(port);
      return port;
    },
    setTimer: (run) => {
      timers.push({ run });
      return timers.length - 1;
    },
    clearTimer: (handle) => {
      if (typeof handle === "number" && timers[handle]) timers[handle].run = () => {};
    },
  });
  client.onSnapshot((event) => snapshots.push(event));
  client.onPatch((event) => patches.push(event));
  client.onFailure((failure) => failures.push(failure));
  client.onLocks((value) => locks.push(value));
  const port = () => ports[ports.length - 1];
  const flushTimers = () => {
    for (const timer of timers.splice(0, timers.length)) timer.run();
  };
  const ready = async (rev = 0, snapshot = one()) => {
    port().open();
    port().deliver({ type: "ready", user: "me" });
    port().deliver({
      type: "snapshot",
      doc,
      rev,
      document: snapshot,
      locks: [],
      peers: [],
    } as CollabServerMessage);
    await settle();
  };
  return { client, ports, port, flushTimers, snapshots, patches, failures, locks, ready };
}

test("the client waits for ready before joining, and seeds a new document", async () => {
  const bark = harness("new", one());
  bark.port().open();
  assert.equal(bark.port().ofType("join").length, 0, "join must wait for ready");
  bark.port().deliver({ type: "ready", user: "me" });
  const join = bark.port().last("join");
  assert.equal(join?.doc, "new");
  assert.deepEqual(join?.document, one());
  assert.equal(bark.client.user, "me");
  bark.client.dispose();
});

test("a cookie session sends no auth frame, and an explicit token does", () => {
  const ports: FakeCollabPort[] = [];
  const make = () => {
    const port = new FakeCollabPort();
    ports.push(port);
    return port;
  };
  const cookie = createCollabClient({ doc: DOC, createPort: make, setTimer: () => 0 });
  ports[0].open();
  assert.equal(ports[0].ofType("auth").length, 0);
  cookie.dispose();

  const token = createCollabClient({
    doc: DOC,
    auth: { token: "jwt" },
    createPort: make,
    setTimer: () => 0,
  });
  ports[1].open();
  assert.equal(ports[1].last("auth")?.token, "jwt");
  token.dispose();
});

test("a snapshot establishes the revision and is reported as a first load", async () => {
  const bark = harness();
  await bark.ready(7);
  assert.equal(bark.client.status, "ready");
  assert.equal(bark.client.rev, 7);
  assert.equal(bark.client.doc, DOC);
  assert.equal(bark.snapshots.length, 1);
  assert.equal(bark.snapshots[0].resync, false, "the first snapshot is not a resync");
  bark.client.dispose();
});

test("submitting a changed document commits the diff against the server revision", async () => {
  const bark = harness();
  await bark.ready(4);
  bark.client.submit(two());
  await settle();
  const commit = bark.port().last("commit");
  assert.ok(commit, "a commit must be sent");
  assert.equal(commit.base, 4, "base must be the server's revision");
  assert.deepEqual(commit.ops.map((op) => op.op), ["replace"]);
  // No hash on the way out: it is optional, and hashing per keystroke would put
  // crypto.subtle on the hot path. The server hashes each patch, which is the direction
  // that detects drift.
  assert.equal(commit.hash, undefined);
  bark.client.dispose();
});

test("submitting an unchanged document sends nothing", async () => {
  const bark = harness();
  await bark.ready(1);
  bark.client.submit(one());
  await settle();
  assert.equal(bark.port().ofType("commit").length, 0);
  bark.client.dispose();
});

test("an ack advances the revision and makes the committed state the new baseline", async () => {
  const bark = harness();
  await bark.ready(1);
  bark.client.submit(two());
  await settle();
  const nonce = bark.port().last("commit")!.nonce;
  bark.port().deliver({ type: "ack", nonce, rev: 2 });
  assert.equal(bark.client.rev, 2);
  assert.equal(bark.patches.at(-1)?.remote, false, "our own work is reported as local");

  // Re-offering the same document must now be a no-op, which is what stops echo loops.
  bark.client.submit(two());
  await settle();
  assert.equal(bark.port().ofType("commit").length, 1);
  bark.client.dispose();
});

test("only one commit is in flight; later edits coalesce into the next one", async () => {
  const bark = harness();
  await bark.ready(1);
  bark.client.submit(two());
  await settle();
  const first = bark.port().last("commit")!;

  const third = document([{ type: "text", id: "t", x: 0, y: 0, fields: { TEXT: "c" } }]);
  bark.client.submit(third);
  await settle();
  assert.equal(bark.port().ofType("commit").length, 1, "the second edit must wait");

  bark.port().deliver({ type: "ack", nonce: first.nonce, rev: 2 });
  await settle();
  const commits = bark.port().ofType("commit");
  assert.equal(commits.length, 2, "the queued edit is sent once the first is acknowledged");
  assert.equal(commits[1].base, 2, "and it bases on the new revision");
  bark.client.dispose();
});

test("patches apply in revision order and are reported as remote", async () => {
  const bark = harness();
  await bark.ready(1);
  bark.port().deliver({
    type: "patch",
    rev: 2,
    by: "them",
    ops: [{ op: "replace", id: "t", block: { type: "text", fields: { TEXT: "theirs" } } }],
  });
  assert.equal(bark.client.rev, 2);
  const patch = bark.patches.at(-1)!;
  assert.equal(patch.remote, true);
  assert.equal(patch.by, "them");
  const applied = patch.document as ReturnType<typeof one>;
  assert.equal(applied.script.workspace.blocks.blocks[0].fields!.TEXT, "theirs");
  bark.client.dispose();
});

test("a patch at or below the current revision is dropped", async () => {
  const bark = harness();
  await bark.ready(5);
  bark.port().deliver({ type: "patch", rev: 5, by: "them", ops: [{ op: "delete", id: "t" }] });
  bark.port().deliver({ type: "patch", rev: 3, by: "them", ops: [{ op: "delete", id: "t" }] });
  assert.equal(bark.patches.length, 0, "already-included revisions must not be re-applied");
  assert.equal(bark.client.rev, 5);
  bark.client.dispose();
});

test("a gap in revisions re-joins with what we have instead of guessing", async () => {
  const bark = harness();
  await bark.ready(5);
  bark.port().deliver({ type: "patch", rev: 9, by: "them", ops: [{ op: "delete", id: "t" }] });
  const join = bark.port().last("join");
  assert.equal(join?.have, 5, "the server is told the last revision we hold");
  assert.equal(bark.client.rev, 5, "and nothing is applied on faith");
  assert.ok(bark.failures.some((failure) => failure.recovering));
  bark.client.dispose();
});

test("an op that cannot be applied resyncs rather than diverging quietly", async () => {
  const bark = harness();
  await bark.ready(1);
  bark.port().deliver({
    type: "patch",
    rev: 2,
    by: "them",
    ops: [{ op: "delete", id: "does-not-exist" }],
  });
  assert.equal(bark.port().last("join")?.have, 1);
  assert.equal(bark.patches.length, 0);
  bark.client.dispose();
});

test("REV_MISMATCH adopts the server's revision and re-joins", async () => {
  const bark = harness();
  await bark.ready(1);
  bark.client.submit(two());
  await settle();
  bark.port().deliver({
    type: "error",
    code: "REV_MISMATCH",
    message: "Someone committed first.",
    rev: 6,
  });
  assert.equal(bark.port().last("join")?.have, 6);
  bark.client.dispose();
});

test("NOT_LOCKED takes the lock the server asked for and retries exactly once", async () => {
  const bark = harness();
  await bark.ready(1);
  bark.client.submit(two());
  await settle();
  bark.port().deliver({ type: "error", code: "NOT_LOCKED", message: "Lock t first." });
  await settle();
  assert.equal(bark.port().last("lock")?.blockId, "t", "the blocked block is locked");
  assert.equal(bark.port().ofType("commit").length, 2, "and the commit is retried");

  // A second refusal must not loop.
  bark.port().deliver({ type: "error", code: "NOT_LOCKED", message: "Still not yours." });
  await settle();
  assert.equal(bark.port().ofType("commit").length, 2, "no infinite retry");
  assert.ok(bark.failures.some((failure) => failure.code === "NOT_LOCKED" && !failure.recovering));
  bark.client.dispose();
});

test("LOCK_HELD surfaces to the UI without resyncing", async () => {
  const bark = harness();
  await bark.ready(1);
  bark.client.submit(two());
  await settle();
  const joinsBefore = bark.port().ofType("join").length;
  bark.port().deliver({ type: "error", code: "LOCK_HELD", message: "them is editing that." });
  assert.equal(bark.port().ofType("join").length, joinsBefore, "a conflict is not a desync");
  assert.equal(bark.failures.at(-1)?.code, "LOCK_HELD");
  bark.client.dispose();
});

test("lock_state tracks ownership and learns this connection's own id", async () => {
  const bark = harness();
  await bark.ready(1);
  bark.client.lock("t");
  const nonce = bark.port().last("lock")!.nonce;
  bark.port().deliver({
    type: "lock_state",
    blockId: "t",
    owner: { user: "me", conn: "conn-1" },
    nonce,
  });
  assert.equal(bark.client.ownConn, "conn-1", "our conn id comes from our own grant");
  assert.deepEqual(bark.client.locks, [{ blockId: "t", user: "me", conn: "conn-1" }]);

  bark.port().deliver({ type: "lock_state", blockId: "t", owner: null });
  assert.deepEqual(bark.client.locks, []);
  assert.ok(bark.locks.length >= 2, "listeners are told about every change");
  bark.client.dispose();
});

test("presence replaces the peer list", async () => {
  const bark = harness();
  await bark.ready(1);
  bark.port().deliver({
    type: "presence",
    peers: [{ user: "me", conn: "c1" }, { user: "them", conn: "c2", blockId: "t" }],
  });
  assert.equal(bark.client.peers.length, 2);
  bark.client.dispose();
});

test("a dropped socket reconnects and re-joins from the last revision held", async () => {
  const bark = harness();
  await bark.ready(3);
  bark.port().drop();
  assert.equal(bark.client.status, "offline");
  bark.flushTimers();
  assert.equal(bark.ports.length, 2, "a fresh port is opened");
  bark.port().open();
  bark.port().deliver({ type: "ready", user: "me" });
  assert.equal(bark.port().last("join")?.have, 3, "the reconnect asks only for what it missed");
  bark.client.dispose();
});

test("a resync snapshot is flagged so the canvas can be rebuilt", async () => {
  const bark = harness();
  await bark.ready(1);
  bark.port().deliver({
    type: "snapshot",
    doc: DOC,
    rev: 9,
    document: two(),
    locks: [],
    peers: [],
  });
  await settle();
  assert.equal(bark.snapshots.at(-1)?.resync, true);
  assert.equal(bark.client.rev, 9);
  bark.client.dispose();
});

test("local edits made while behind are re-derived against the new baseline", async () => {
  const bark = harness();
  await bark.ready(1);
  bark.client.submit(two());
  await settle();
  // The server rejects it and hands us a different world.
  bark.port().deliver({ type: "error", code: "REV_MISMATCH", message: "behind", rev: 4 });
  bark.port().deliver({
    type: "snapshot",
    doc: DOC,
    rev: 4,
    document: one(),
    locks: [],
    peers: [],
  });
  await settle();
  const commits = bark.port().ofType("commit");
  assert.equal(commits.length, 2, "the local edit is re-offered, not dropped");
  assert.equal(commits[1].base, 4, "against the revision we now hold");
  bark.client.dispose();
});

test("dispose stops the socket and silences listeners", async () => {
  const bark = harness();
  await bark.ready(1);
  const port = bark.port();
  bark.client.dispose();
  assert.equal(bark.client.status, "disposed");
  assert.equal(port.closed, true);
  const before = bark.patches.length;
  port.deliver({ type: "patch", rev: 2, by: "them", ops: [{ op: "delete", id: "t" }] });
  assert.equal(bark.patches.length, before, "frames after dispose are ignored");
});

test("heartbeats renew only while a lock is held", async () => {
  const bark = harness();
  await bark.ready(1);
  bark.flushTimers();
  assert.equal(bark.port().ofType("heartbeat").length, 0, "nothing to renew yet");

  bark.client.lock("t");
  const nonce = bark.port().last("lock")!.nonce;
  bark.port().deliver({
    type: "lock_state",
    blockId: "t",
    owner: { user: "me", conn: "c1" },
    nonce,
  });
  bark.flushTimers();
  assert.equal(bark.port().ofType("heartbeat").length, 1, "a held lock is kept alive");

  bark.client.unlock("t");
  bark.flushTimers();
  assert.equal(bark.port().ofType("heartbeat").length, 1, "and stops once released");
  bark.client.dispose();
});
