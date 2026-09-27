# Canvas workspace protocol v3

The gateway's `/ws/` endpoint uses the existing HttpOnly access cookie and origin
allowlist. The `ready` frame contains `protocol: 3`, authenticated `user`, and a
unique `conn`. Tokens expire while connected. Every durable operation rechecks
workspace membership; knowing an ID never grants membership.

## Join and synchronize

Send `{type:"join", protocol:3, doc:<game UUID>, have?:<revision>}`. Creation is
through Canvas only. The service sends ordered `patch` frames from retained
history or a `snapshot` containing the Canvas document. `joined` ends replay and
includes revision, connection ID, roster, and locks. Drop duplicate revisions;
request synchronization for gaps. A periodic `state` frame supplies current
revision, locks, and members, recovering missed Redis notifications and access
revocation even when no further edits happen.

An already joined connection can send `{type:"sync", have:<revision>}` to catch
up without leaving the room, releasing its leases, or interrupting typing.
The response is the same replay/snapshot followed by `joined`.

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
prefabs, and name. Python source changes use `source` with string `before` and
`value`. This resource needs no exclusive lease, but still checks membership,
revision, before-value and Python document validity. Another connection's
`script` or `*` lease blocks source writes during replacement. A confirmed import or
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
Python clients map unsent text changes over accepted revisions using CodeMirror
ChangeSet operational transformation (server changes first), then retry with a
new commit ID. Remote text transactions preserve unchanged ranges, cursor
positions, and local undo. Other resource edits require unchanged before-values;
conflicts offer reload or a personal copy. Do not continue shared mutation while offline.

## Live workspace presence

Send `{type:"presence", camera?:{position:{x,y,z},target:{x,y,z}}, selected?:<id|null>,
view:"viewport"|"code"|"design", preview?:{id,transform}|null}`. The browser sends
at most about 12 frames/second; the server bounds coordinates and limits presence
to 20 frames/second. Transform previews require the connection's entity or whole
workspace lease. User and connection IDs come from authentication, never this payload.

The existing `presence` response contains `peers` with these fields and their
authenticated `user`, `conn`, and editing `resource`. Redis distributes the
transient state across workers. Disconnects remove peers; stale peers expire
after eight seconds. Camera frusta, name labels, selections, and object drag
previews are editor presentation only. They never enter Canvas documents, JSON
exports, undo history, physics, or game scripts. A committed transform still
travels through the durable `commit` path; cancellation restores its saved pose.

Deploy the updated web, server and websocket code together. Protocol 2 joins are
rejected with a reload message because old clients cannot apply `source` edits. This remains
workspace co-editing; each Play session runs its own local game simulation.

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

### Object scripts (document version 2)

`objectScripts` is a map from existing entity ID to a Blocks/Python script. The existing `script`, `source`, `variables`, and `block:<root-id>` resources still refer to global code. Object resources are `object:<encodeURIComponent(entity-id)>:script`, `:source`, `:variables`, and `:block:<root-id>`. IDs are encoded so colons and Unicode cannot split resource boundaries.

Python source edits remain concurrent without leases. Script conversion locks conflict with resources in that script only; identical block IDs in different scripts do not conflict. A whole-document `*` lock covers all scripts. First edits create an entire object script. Delete the object and its script in the same commit. Upgrading a legacy document uses a `version` resource edit from 1 to 2, creating the empty object-script map before other changes.

Deploy the Canvas object-script migration with the matching editor, websocket service and player. Legacy files remain importable; older readers reject exported version 2 files instead of silently ignoring object behavior.
