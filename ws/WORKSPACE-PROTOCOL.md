# Canvas workspace protocol v2

The gateway's `/ws/` endpoint uses the existing HttpOnly access cookie and origin
allowlist. The `ready` frame contains `protocol: 2`, authenticated `user`, and a
unique `conn`. Tokens expire while connected. Every durable operation rechecks
workspace membership; knowing an ID never grants membership.

## Join and synchronize

Send `{type:"join", protocol:2, doc:<game UUID>, have?:<revision>}`. Creation is
through Canvas only. The service sends ordered `patch` frames from retained
history or a `snapshot` containing the Canvas document. `joined` ends replay and
includes revision, connection ID, roster, and locks. Drop duplicate revisions;
request synchronization for gaps. A periodic `state` frame supplies current
revision, locks, and members, recovering missed Redis notifications and access
revocation even when no further edits happen.

Canvas Game and its section rows are the only durable document. Django owns
schema and transactions. The socket service calls those functions using
`sync_to_async`; room fan-out still uses Redis, or LocalBus for single-worker
development. Legacy standalone `collab_*` tables are not modified or exposed.

## Locks and edits

Send `{type:"lock", resources:[...], nonce}` and await `locked` with matching
nonce. Resources are `entity:<id>`, `block:<root-id>`, `script`, `variables`,
`section:<name>`, and `*`. Root-block locks cover their entire Blockly subtree;
entity locks conflict with ancestors/descendants. `script` conflicts with all
block/variable resources; `*` conflicts with everything. A connection can hold
the resources needed by one multi-item interaction. Locks last 30 seconds;
`heartbeat` every five seconds renews live leases. `unlock` releases the
connection's locks; disconnect and membership removal also release them.

An edit is `{op:"set", resource, before, value}`. Null deletes an entity/root
block. Sections include settings, cameras, input, properties, assets, materials,
prefabs, and name. Python uses the whole script resource. A confirmed import or
language conversion takes `*`. All edits in a commit apply atomically.

Send `{type:"commit", base, commitId:<UUID>, ops:[...]}`. Membership, locks,
revision, original resource values, owner-only renaming, document validity and
size are checked inside the same transaction locking the Game row. Canvas rows
and operation history are saved together. Initial activation assigns stable IDs
to legacy blocks that omitted them, so clients share the same resource identity. `ack` means durable persistence;
retrying an identical commit ID returns its original revision without applying
twice. A patch carries revision, operations, author, connection, commit ID, and
a SHA-256 document digest. Numeric values are normalized to IEEE-754 binary64
hex before canonical JSON hashing so Python and JavaScript agree.

Errors include `FORBIDDEN`, `REV_MISMATCH`, `CONFLICT`, `LOCK_HELD`, `NOT_LOCKED`,
`INVALID_OP`, `LIMIT_EXCEEDED`, and `UNAVAILABLE`. Preserve unsent local work.
Only rebase edits whose original resource values remain unchanged. Otherwise
offer reload or a personal copy. Do not continue shared mutation while offline.

## Setup and tests

Run Django migrations before starting websocket workers. The websocket image
now builds from the repository root and packages the same server Python source
and pinned requirements. `WS_AUTO_MIGRATE` is obsolete for workspace editing.
All workers must use the same PostgreSQL database and Redis URL.

`python -m pytest ws/tests` runs pure protocol/algebra tests. Set `WS_TEST_DSN`
to a disposable PostgreSQL database to run socket transaction tests; they apply
migrations and remove only their own users/games. Browser integration uses real
cookies through the gateway: `npm --prefix web run test:integration -- collaboration.spec.ts`.
Run with multiple websocket workers to validate cross-worker Redis delivery.
SQLite/LocalBus development checks do not establish PostgreSQL concurrency.
