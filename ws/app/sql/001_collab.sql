-- Collaboration schema. Applied at startup when WS_AUTO_MIGRATE=1.
--
-- Every statement is idempotent so it is safe to run on every boot. Django owns
-- migrations long-term, but server/ has no Django project on main and no migration
-- files anywhere, so gating these tables behind that work would block collaboration
-- entirely. Fold this into a Django migration once the Django app lands, then set
-- WS_AUTO_MIGRATE=0.

CREATE TABLE IF NOT EXISTS collab_doc (
    id           uuid PRIMARY KEY,
    owner_id     varchar(132) NOT NULL,
    title        text   NOT NULL DEFAULT 'Untitled',
    rev          bigint NOT NULL DEFAULT 0,
    snapshot     jsonb  NOT NULL,
    snapshot_rev bigint NOT NULL DEFAULT 0,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
);

-- Append-only op log. Replayed on top of `snapshot` to reach `rev`, which is what lets a
-- reconnecting client catch up with `join {have}` instead of refetching the document.
CREATE TABLE IF NOT EXISTS collab_op (
    doc_id     uuid   NOT NULL REFERENCES collab_doc(id) ON DELETE CASCADE,
    rev        bigint NOT NULL,
    user_id    varchar(132) NOT NULL,
    ops        jsonb  NOT NULL,
    hash       text,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (doc_id, rev)
);

-- One row per held lock. block_id '*' is the document-level lock and conflicts with
-- everything. Ancestor/descendant conflicts are decided in Python against the room's
-- block index, inside a transaction that holds the collab_doc row.
CREATE TABLE IF NOT EXISTS collab_lock (
    doc_id     uuid   NOT NULL REFERENCES collab_doc(id) ON DELETE CASCADE,
    block_id   text   NOT NULL,
    user_id    varchar(132) NOT NULL,
    conn_id    uuid   NOT NULL,
    expires_at timestamptz NOT NULL,
    PRIMARY KEY (doc_id, block_id)
);

-- One lock per connection is an invariant, so this index makes release-on-disconnect and
-- heartbeat renewal single-row operations.
CREATE INDEX IF NOT EXISTS collab_lock_conn_idx ON collab_lock (doc_id, conn_id);

CREATE TABLE IF NOT EXISTS collab_member (
    doc_id   uuid NOT NULL REFERENCES collab_doc(id) ON DELETE CASCADE,
    user_id  varchar(132) NOT NULL,
    role     text NOT NULL DEFAULT 'editor',
    joined_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (doc_id, user_id)
);
