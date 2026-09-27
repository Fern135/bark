# Bark collaboration protocol (v1)

> Legacy standalone protocol, retained as reference for its block algebra tests.
> The active `/ws/` endpoint uses [Canvas workspace protocol v2](WORKSPACE-PROTOCOL.md).
> Legacy `join {doc:"new"}` and ID-based automatic membership are disabled.

One document, many editors, server-authoritative. The server owns the truth, clients
send *intent*, and a per-subtree **lock** is the ownership flag that stops two people
dragging the same blocks at once.

This file is the contract. `scripting/src/collab/types.ts` and
`ws/app/collab/protocol.py` must agree with it; change this file first.

## Transport

- One WebSocket per client to `/ws/` (nginx proxies it to the `ws` service; see `proxy/nginx.conf`).
- Auth is unchanged from the existing skeleton: the `access_token` HttpOnly cookie, or a
  first `{"type": "auth", "token": "..."}` frame within `WS_AUTH_TIMEOUT` seconds.
  Claims required by `ws/app/auth.py`: `sub`, `iat`, `exp`, `iss`, `aud`, `type="access"`.
- The identity of a client is **always** `claims["sub"]`. A `user_id` in a client frame is ignored.
- Server sends `{"type": "ready", "user": "<sub>"}` once authenticated, then waits for `join`.
- Every frame is JSON. Max inbound frame: `WS_MAX_MESSAGE_BYTES` (1 MiB).

## Terms

| Term | Meaning |
|---|---|
| `doc` | A `GameDocument` (`{version: 1, project, script}`) with an id and a revision. |
| `rev` | Monotonic per-doc revision. Starts at 0. Every accepted commit bumps it by exactly 1. |
| `op` | One primitive change to the block workspace. See **Ops**. |
| lock | Exclusive ownership of a block **and its whole subtree**, held by one connection. |
| `epoch` | Client-side generation counter, for the client to drop its own stale traffic after a resync. Mirrors `session: number` in `scripting/src/types.ts`. The server does not interpret it. |
| `nonce` | Client-chosen correlation id, returned in `ack` / `lock_state`. |

Only `script.workspace` is merged op-by-op. `project` is replaced wholesale under the
document-level lock (block id `"*"`), which is rarely contended.

## Client -> server

```jsonc
{ "type": "join", "doc": "new", "document": { ... } }   // create: seeds from the caller's document
{ "type": "join", "doc": "<uuid>", "have": 41 }          // open: "have" enables op replay instead of a snapshot
{ "type": "lock",   "blockId": "b7", "nonce": 3 }
{ "type": "unlock", "blockId": "b7" }
{ "type": "commit", "base": 41, "ops": [ ... ], "nonce": 4 }   // "hash" optional, see below
{ "type": "presence", "blockId": "b7" }                  // ephemeral, never persisted; blockId optional
{ "type": "heartbeat" }                                  // renews this connection's locks
```

## Server -> client

```jsonc
{ "type": "ready",    "user": "<sub>" }
{ "type": "snapshot", "doc": "<uuid>", "rev": 41, "document": {...}, "locks": [...], "peers": [...] }
{ "type": "patch",    "rev": 42, "ops": [...], "by": "<sub>", "hash": "..." }
{ "type": "ack",      "nonce": 4, "rev": 42 }
{ "type": "lock_state", "blockId": "b7", "owner": {"user": "...", "conn": "...", "name": "..."} | null, "nonce": 3 }
{ "type": "presence", "peers": [ {"user": "...", "conn": "...", "blockId": "b7"} ] }
{ "type": "error",    "code": "REV_MISMATCH", "message": "...", "rev": 42 }
```

`patch` goes to every connection in the room **including the author** — the author
recognises its own work because it already holds `ack` for that `rev`, and applies the
patch idempotently. Fan-out happens only through the bus, so every worker delivers the
same order.

### Error codes

| Code | Meaning | Client should |
|---|---|---|
| `REV_MISMATCH` | `base` was not the current rev. `rev` carries the truth. | Re-join with `have` and replay, then re-diff. |
| `LOCK_HELD` | Another connection holds a conflicting lock. `lock_state.owner` names them. | Leave the blocks alone; show the owner badge. |
| `NOT_LOCKED` | Commit touched a subtree the sender does not own. | Acquire the lock, then retry once. |
| `NOT_FOUND` | Unknown doc, or an op referenced a missing block. | Re-join for a fresh snapshot. |
| `FORBIDDEN` | Not a member of this doc. | Stop. |
| `LIMIT_EXCEEDED` | Rate limit or size cap. | Back off; coalesce edits. |
| `INVALID_OP` | Malformed frame or unapplicable op. | Bug. Re-join for a fresh snapshot. |

## Ops

Ops mutate `script.workspace`, which is native Blockly JSON:
`{ variables: [{name, id}], blocks: { languageVersion: 0, blocks: [roots] } }`.

```jsonc
{ "op": "create",  "block": {...}, "x": 30, "y": 30 }          // new root subtree
{ "op": "replace", "id": "b7", "block": {...} }                 // fields, extraState, shadows, inner shape
{ "op": "attach",  "id": "b7", "parent": "b2", "connection": {"input": "DO0"} }
{ "op": "attach",  "id": "b7", "parent": "b2", "connection": {"next": true} }
{ "op": "detach",  "id": "b7", "x": 120, "y": 240 }             // becomes a root
{ "op": "move",    "id": "b7", "x": 120, "y": 240 }             // reposition a root
{ "op": "delete",  "id": "b7" }                                 // removes the subtree
{ "op": "var_set", "id": "v1", "name": "score" }
{ "op": "var_delete", "id": "v1" }
{ "op": "project", "project": {...} }                           // whole-value, needs the "*" lock
```

Three rules keep this small enough to trust:

1. **Ops come from a structural diff, not from Blockly events.** The editor already
   re-serialises the whole workspace on every change, so the client diffs
   `lastAcked` against `current`. Deterministic, and testable on plain JSON.
2. **Shadow blocks and `extraState` are content, never identities.** A changed
   `{hasElse: true}` / `{itemCount: N}` / `{name, params}`, or a shadow appearing or
   disappearing, becomes one `replace` at the nearest real block. `replace` carries the
   real child ids, so nothing below is regenerated.
3. **Echo loops are structurally impossible.** After applying a patch the client sets
   `lastAcked` to the post-apply JSON, so its next diff is empty.

Apply order within one commit is the array order. The client emits:

    detach -> delete -> create -> attach -> replace -> move -> variable ops

The order is load-bearing, not cosmetic:

- **detach before delete**, or a block dragged out of a subtree the same edit deletes would be
  destroyed along with its old parent.
- **detach before attach**, so every slot is free when the attach phase runs and two blocks can
  swap places without a transient collision.
- **create before attach**, so the target exists; attaches are sorted parent-first.
- **replace last**, once the structure already matches. That is what makes it safe to send a
  whole subtree: every id the replacement carries is already sitting where it expects.

A new subtree is sent with any descendant that already exists elsewhere stripped out; those
keep their identity and arrive via `attach` instead, so no id is ever created twice.

## Locks

- A lock on `B` covers **`B` and every descendant of `B`**.
- Two locks conflict when one is the other, or either is an ancestor of the other.
- **One lock per connection.** Requesting a second releases the first. This keeps the
  lock table no larger than the number of collaborators.
- `"*"` is the document-level lock, used for `project` ops. It conflicts with everything.
- TTL is `WS_LOCK_TTL` seconds (default 30), renewed by `heartbeat` at TTL/3. **A live
  lock is never stolen**; the TTL exists only so a crashed client releases eventually.
- Disconnect releases immediately.

### Commit authorisation

For each op:

- the **primary** block (`id`) must be covered by a lock held by *this* connection —
  except `create` and the variable ops, which need none;
- no **other** connection may hold a lock conflicting with any block the op touches
  (for `attach` that includes `parent`, so dropping into someone else's stack is denied).

### Why locks make coarse `replace` safe

`replace` overwrites a whole subtree. That would be lossy if someone else could be
editing inside it — but holding the lock means nobody can be, because a descendant
lock conflicts with it. The lock model is what buys the simple op set.

### Mid-drag rule: prevent, do not recover

Mutating a Blockly workspace mid-gesture is not safe, so the client must make the bad
case unreachable:

1. Blocks under someone else's lock get `setMovable(false)` / `setEditable(false)` /
   `setDeletable(false)`, so Blockly refuses to start the gesture.
2. Remote patches that arrive during a local drag are **queued** and flushed on drag end.
   Safe because a lock guarantees the queue cannot touch the dragged subtree.
3. If a lock is lost while dragging anyway (a stall longer than the TTL), the client
   calls `workspace.cancelCurrentGesture()` **before** applying anything, then re-acquires.

Server-side rejection is the backstop, not the mechanism.

## Ordering and recovery

- A client applies patches strictly in `rev` order, and **drops any patch whose `rev` is
  not greater than its own**. That rule is what makes joining safe: a connection is added
  to the room before its snapshot is built, so a patch can be queued ahead of the snapshot,
  but it is always at a `rev` the snapshot already includes.
- A gap (`rev > mine + 1`) means the client missed one: re-`join` with
  `have = <last applied rev>`.
- `hash` is `sha256` over the canonical JSON of the resulting workspace — sorted keys, compact
  separators, `ensure_ascii=False`. Clients compare after applying; a mismatch means
  divergence, and the only correct response is to re-join for a fresh snapshot. This is the
  cheap divergence detector — keep it.

A `commit` may carry a `hash` too, and the reference client **does not** send one: computing
it means awaiting `crypto.subtle` on the path of every keystroke, and the server hashes each
`patch` anyway. Drift is therefore detected in the server→client direction, where being
asynchronous costs nothing. A client that does send one gets a server-side warning log on
mismatch, which is useful while the two diff implementations are still settling.

Two normalisation rules exist purely so that hash can be trusted. Both sides implement them,
and breaking either makes every commit look like divergence:

- **An emptied connection is removed, not left as `{}`.** Blockly's own serializer omits a slot
  that holds nothing, so a `detach` that left `"next": {}` behind would hash differently from
  the same workspace re-serialised by the editor. An `inputs` map that becomes empty goes too.
  A slot still holding a shadow is content and stays.
- **`x` and `y` are integers.** The server coerces them, so a client that sent `30.5` would
  hash `30.5` against the server's `30` forever. Round before sending.
- `join` with `have` replays ops when they are still retained, otherwise the server sends
  a full snapshot. Either way the client ends at the server's `rev`.

## Storage

Postgres is the authority; server memory is a cache. See `ws/app/sql/001_collab.sql`.

| Table | Holds |
|---|---|
| `collab_doc` | id, owner, `rev`, `snapshot` jsonb, `snapshot_rev` |
| `collab_op` | append-only log keyed `(doc_id, rev)` |
| `collab_lock` | `(doc_id, block_id)` -> user, conn, `expires_at` |
| `collab_member` | who may join |

Rev allocation is a compare-and-swap in one statement, so concurrent committers
serialise on the `collab_doc` row and no advisory lock is needed.

Redis carries fan-out only (`bark:doc:{id}`) plus ephemeral presence. With no
`REDIS_URL` the service falls back to an in-process bus — same interface, single worker.

## Open coordination item

Nothing issues a JWT yet: `server/authenticator/views.py::login` is a stub and
`authenticator/migrations/` is empty. Until Django signs tokens with the claims above,
use `scripting/scripts/dev-token.mjs` locally. The `collab_*` DDL is applied by `ws` at
startup when `WS_AUTO_MIGRATE=1`; fold it into a Django migration once the Django app
lands.
