// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The database schema as a forward-only list of migrations. Entry N brings a
// database from `user_version` N to N+1. Never edit a shipped entry — append.
//
// What is stored where (SPEC §5): everything user-authored is ciphertext —
// `meta`, `value`, `wrap`, `payload` and the encrypted path/collection/key
// strings. Secrets (tokens, pairing and invite codes) are stored as SHA-256.

export const MIGRATIONS: readonly string[] = [
  `
  CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE accounts (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL UNIQUE COLLATE NOCASE,
    role          TEXT NOT NULL CHECK (role IN ('admin', 'member', 'guest')),
    quota_bytes   INTEGER,
    aek_public    TEXT,
    recovery_wrap TEXT,
    created_at    INTEGER NOT NULL,
    disabled_at   INTEGER
  );

  CREATE TABLE devices (
    id           TEXT PRIMARY KEY,
    account_id   TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    platform     TEXT NOT NULL,
    dsk_public   TEXT NOT NULL,
    dek_public   TEXT NOT NULL,
    device_wrap  TEXT,
    origin       TEXT,
    created_at   INTEGER NOT NULL,
    last_seen_at INTEGER,
    revoked_at   INTEGER
  );
  CREATE INDEX devices_account ON devices(account_id);

  CREATE TABLE challenges (
    challenge  TEXT PRIMARY KEY,
    device_id  TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE tokens (
    hash       TEXT PRIMARY KEY,
    device_id  TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX tokens_device ON tokens(device_id);

  CREATE TABLE pairings (
    id               TEXT PRIMARY KEY,
    code_hash        TEXT NOT NULL UNIQUE,
    account_id       TEXT REFERENCES accounts(id) ON DELETE CASCADE,
    new_account_name TEXT,
    new_account_role TEXT CHECK (new_account_role IN ('admin', 'member', 'guest')),
    transfer         TEXT,
    created_by       TEXT,
    created_at       INTEGER NOT NULL,
    expires_at       INTEGER NOT NULL,
    used_at          INTEGER,
    CHECK ((account_id IS NULL) <> (new_account_name IS NULL))
  );

  CREATE TABLE namespaces (
    id               TEXT PRIMARY KEY,
    app              TEXT NOT NULL,
    owner_account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    epoch            INTEGER NOT NULL DEFAULT 1,
    meta             TEXT NOT NULL,
    meta_rev         INTEGER NOT NULL DEFAULT 0,
    members_rev      INTEGER NOT NULL DEFAULT 0,
    seq              INTEGER NOT NULL DEFAULT 0,
    purged_seq       INTEGER NOT NULL DEFAULT 0,
    used_bytes       INTEGER NOT NULL DEFAULT 0,
    created_at       INTEGER NOT NULL,
    deleted_at       INTEGER
  );
  CREATE INDEX namespaces_owner ON namespaces(owner_account_id);

  CREATE TABLE members (
    namespace_id TEXT NOT NULL REFERENCES namespaces(id) ON DELETE CASCADE,
    account_id   TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    role         TEXT NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
    created_at   INTEGER NOT NULL,
    PRIMARY KEY (namespace_id, account_id)
  );
  CREATE INDEX members_account ON members(account_id);

  CREATE TABLE key_wraps (
    namespace_id TEXT NOT NULL REFERENCES namespaces(id) ON DELETE CASCADE,
    epoch        INTEGER NOT NULL,
    account_id   TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    wrap         TEXT NOT NULL,
    PRIMARY KEY (namespace_id, epoch, account_id)
  );

  CREATE TABLE invites (
    id           TEXT PRIMARY KEY,
    namespace_id TEXT NOT NULL REFERENCES namespaces(id) ON DELETE CASCADE,
    code_hash    TEXT NOT NULL UNIQUE,
    role         TEXT NOT NULL CHECK (role IN ('editor', 'viewer')),
    payload      TEXT NOT NULL,
    created_by   TEXT NOT NULL,
    created_at   INTEGER NOT NULL,
    expires_at   INTEGER NOT NULL,
    max_uses     INTEGER NOT NULL,
    uses         INTEGER NOT NULL DEFAULT 0,
    revoked_at   INTEGER
  );

  CREATE TABLE blobs (
    hash       TEXT PRIMARY KEY,
    size       INTEGER NOT NULL,
    refs       INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );

  -- One row per path. A deleted file stays as a tombstone (blob_hash NULL)
  -- so the change feed can report the deletion.
  CREATE TABLE files (
    namespace_id TEXT NOT NULL REFERENCES namespaces(id) ON DELETE CASCADE,
    path         TEXT NOT NULL,
    file_id      TEXT NOT NULL,
    rev          INTEGER NOT NULL,
    size         INTEGER NOT NULL,
    blob_hash    TEXT,
    meta         TEXT,
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL,
    PRIMARY KEY (namespace_id, path)
  );
  CREATE INDEX files_rev ON files(namespace_id, rev);
  CREATE INDEX files_id ON files(namespace_id, file_id);

  -- Every version of every file, the current one included.
  CREATE TABLE file_revisions (
    namespace_id TEXT NOT NULL REFERENCES namespaces(id) ON DELETE CASCADE,
    file_id      TEXT NOT NULL,
    rev          INTEGER NOT NULL,
    path         TEXT NOT NULL,
    size         INTEGER NOT NULL,
    blob_hash    TEXT NOT NULL,
    meta         TEXT,
    created_at   INTEGER NOT NULL,
    PRIMARY KEY (namespace_id, file_id, rev)
  );

  CREATE TABLE trash (
    namespace_id TEXT NOT NULL REFERENCES namespaces(id) ON DELETE CASCADE,
    file_id      TEXT NOT NULL,
    path         TEXT NOT NULL,
    rev          INTEGER NOT NULL,
    size         INTEGER NOT NULL,
    meta         TEXT,
    deleted_at   INTEGER NOT NULL,
    PRIMARY KEY (namespace_id, file_id)
  );

  -- Rows / key-value. value NULL = tombstone.
  CREATE TABLE records (
    namespace_id TEXT NOT NULL REFERENCES namespaces(id) ON DELETE CASCADE,
    collection   TEXT NOT NULL,
    key          TEXT NOT NULL,
    rev          INTEGER NOT NULL,
    value        BLOB,
    size         INTEGER NOT NULL DEFAULT 0,
    updated_at   INTEGER NOT NULL,
    PRIMARY KEY (namespace_id, collection, key)
  );
  CREATE INDEX records_rev ON records(namespace_id, rev);

  CREATE TABLE uploads (
    id           TEXT PRIMARY KEY,
    namespace_id TEXT NOT NULL REFERENCES namespaces(id) ON DELETE CASCADE,
    account_id   TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    size         INTEGER NOT NULL DEFAULT 0,
    created_at   INTEGER NOT NULL,
    expires_at   INTEGER NOT NULL
  );

  CREATE TABLE upload_parts (
    upload_id TEXT NOT NULL REFERENCES uploads(id) ON DELETE CASCADE,
    n         INTEGER NOT NULL,
    blob_hash TEXT NOT NULL,
    size      INTEGER NOT NULL,
    PRIMARY KEY (upload_id, n)
  );

  CREATE TABLE audit (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    at        INTEGER NOT NULL,
    actor     TEXT,
    action    TEXT NOT NULL,
    target    TEXT,
    ip        TEXT,
    detail    TEXT,
    prev_hash TEXT NOT NULL,
    hash      TEXT NOT NULL
  );

  CREATE TABLE origins (
    origin     TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL
  );
  `,
];
