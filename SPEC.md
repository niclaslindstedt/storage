# storage — specification

> The authoritative design for the self-hosted, end-to-end-encrypted storage
> backend and its client module in `@niclaslindstedt/oss-framework`. If work is
> interrupted, **resume from §15 (Progress)** — every task there points at the
> section that defines it.

- Status: **in development**
- Spec version: 1.0.0 (2026-09-27)
- Owner: Niclas Lindstedt

---

## 0. Decisions log

| # | Decision | Chosen | Why |
|---|---|---|---|
| D1 | Server language | **TypeScript on Node ≥ 22** | Same language as every app and the framework; the real server runs in-process inside Vitest/Playwright; zero runtime dependencies (`node:http`, `node:crypto`, `node:sqlite`). |
| D2 | Tenancy | **Household server** | One admin, several accounts (family), guests invited to single namespaces; open sign-up off by default; per-account quotas. |
| D3 | TLS at home | **Built-in ACME** (Let's Encrypt; DNS name *or* bare public IP via short-lived IP certificates) + UPnP/NAT-PMP port mapping; also `files`, `self-signed` (native-only, pinned), and `off` (behind a reverse proxy / tunnel). | Browser PWAs cannot pin a self-signed certificate; they need a publicly trusted one. |
| D4 | Scope of this round | **Server + framework client module + testkit + full-stack e2e tests.** Apps adopt it in a follow-up. | Answer to the scope question. Healthcare apps (meds, period, baby) are first-class targets: the design must satisfy them (see §2). |
| D5 | Encryption | **Zero-knowledge end-to-end encryption, mandatory.** The server never holds a key that decrypts content, names, or metadata. | Healthcare data. The hoster (even the admin) sees only ciphertext and structure. |
| D6 | Client key storage | **`KeyVault`** seam: IndexedDB holding *non-extractable* `CryptoKey`s on the web; a native host (`window.__ossKeyVault`, Keychain / Android Keystore / Secure Enclave) in wrappers. | Keys must be safe on the device too, not only on the server. |
| D7 | Conflict granularity | **Row level** (records) with automatic field-level 3-way merge; atomic compare-and-swap for files. | The apps' current check-then-write races and whole-document "keep mine/theirs" lose data. |
| D8 | Crypto primitives | WebCrypto only: **P-256** ECDSA/ECDH, HKDF-SHA-256, AES-256-GCM, HMAC-SHA-256, PBKDF2 only for optional vault PINs. | Available in every browser, Node, and native WebView; FIPS-approved algorithms (healthcare-friendly). |
| D9 | Storage engine | SQLite (`node:sqlite`, WAL) for metadata + content-addressed blob directory. `:memory:` + in-memory blobs for tests. | One implementation for production and tests; no native addons. |
| D10 | License | PolyForm-Noncommercial-1.0.0 | Matches the sibling repos. |
| D11 | Out of scope | Server-side search / thumbnails (server cannot read data); federation between servers. | E2EE makes them impossible or a leak. |

---

## 1. Goals

1. **Replace Dropbox / iCloud / Google Drive** for the local-first PWAs built on
   `oss-framework` (notes, contacts, meds, checklist, period, time, calendar,
   calc, baby) with a backend the user owns — at home or on any cloud host.
2. **Be better than a general-purpose drive for these apps**: race-free
   conflicts, row-level merge, tombstones, live change feed, history, trash,
   per-namespace sharing, synced namespace registry.
3. **Be safe for healthcare data**: end-to-end encryption, device-bound keys,
   no passwords, least privilege, tamper-evident audit log, secure defaults.
4. **Be trivial to host**: one Docker image or one `npx` command, UPnP port
   mapping, automatic certificates, QR-code device pairing.
5. **Be trivial to test against**: an in-process test server with seeding,
   snapshots, fault injection and clock control, usable from Vitest and
   Playwright in every app.

## 2. What the apps need (survey summary)

| App | Layout today | Conflict handling today | Needs |
|---|---|---|---|
| meds, period, baby (health) | one encrypted JSON doc (`oss.encrypted.v1`) | merge per record by `updatedAt`, no tombstones | row-level merge, tombstones, E2EE, iCloud is banned for health data → **this backend is their recommended remote** |
| time | one JSON doc | merge per record by `updatedAt` | row-level merge |
| calendar | one JSON doc per calendar (`/<slug>/calendar.json`) | remote wins (drops local edit) | CAS + merge, synced calendar registry |
| contacts | one JSON doc per namespace + binary photos/attachments + atlas zips | whole-doc, remote wins | binary files, large uploads, per-namespace isolation (today one namespace's prune can delete another's photos) |
| notes | one markdown file per note + sidecars + binary attachments, encrypted filenames optional | whole-doc keep mine/theirs, 10 s polling | recursive list with revs, cheap incremental listing, push instead of polling, move/rename |
| calc | one markdown file per session | none (last writer wins) | CAS per file |
| checklist | one markdown file per item (vendored storage) | aggregate rev, keep mine/theirs | CAS, change feed |

Common denominator (what every app already uses): the framework `FileStore`
(`list` recursive with per-file `rev`, `read`, `write`, `remove`) and
`StorageAdapter` (`load`, `save(text, baseRevision)` → `ConflictError`,
`probe`, `getRevision`, `watch`). **The client module implements both
contracts exactly**, so any app switches backend with a one-line change, and
then opts into the richer APIs (records, row documents, sharing) at its pace.

## 3. Architecture

```
┌──────────── device (PWA / native wrapper) ────────────┐        ┌────────────── server ──────────────┐
│ app  ──►  oss-framework/storage/selfhosted             │  TLS   │ HTTP API (/v1)                     │
│           ├─ FileStore / StorageAdapter / RecordStore  │◄──────►│ ├─ auth (device signatures)        │
│           ├─ crypto (E2EE: seal/open, names, wraps)    │ JSON + │ ├─ accounts, devices, pairing      │
│           ├─ KeyVault (IndexedDB non-extractable /     │ octets │ ├─ namespaces, members, invites    │
│           │   native Keychain/Keystore)                │  SSE   │ ├─ files, uploads, history, trash  │
│           └─ pairing / sharing / rotation              │        │ ├─ records (rows), batch, changes  │
└────────────────────────────────────────────────────────┘        │ ├─ events (SSE), audit (hash chain)│
                                                                   │ ├─ SQLite (WAL) + blob directory  │
                                                                   │ ├─ ACME / TLS, UPnP / NAT-PMP      │
                                                                   │ └─ CLI, QR, local admin page       │
                                                                   └────────────────────────────────────┘
```

Repository layout (npm workspaces):

```
packages/server/     @niclaslindstedt/storage-server   (server + CLI `storage-server`)
packages/testkit/    @niclaslindstedt/storage-testkit  (in-process + subprocess test server, helpers)
e2e/                 full-stack tests: framework client ↔ real server (private)
docs/ man/ examples/ website/ scripts/ prompts/ .agents/skills/   (OSS_SPEC)
Dockerfile  compose.yaml
```

Framework side (`/home/user/oss-framework`, branch `claude/loving-wright-jg6oj0`):

```
src/storage/selfhosted/   client module (subpath export ./storage/selfhosted)
src/qr/                   QR encoder + SVG + <QrCode> component (subpath ./qr)
```

Dependency direction: server ← (HTTP only) → framework client. The testkit's
server controls never import the framework; its optional seeding helpers take
the framework client as a peer dependency. `e2e/` imports the framework from
source (`OSS_FRAMEWORK_DIR`, default `../oss-framework`; CI checks it out at
the ref in `e2e/framework-ref`).

## 4. Security model

### 4.1 Threat model

| Adversary | Can | Cannot |
|---|---|---|
| Hoster / server admin / attacker with the disk or DB | see account & device names, namespace count, app ids, sizes, timestamps, tree shape, access patterns | read content, file names, record keys, namespace names, metadata; forge a device; swap/move ciphertext undetected; decrypt after a key rotation |
| Network attacker | see TLS metadata | read or modify traffic (TLS 1.2+, HSTS; native wrappers may also pin via the QR `fp`) |
| Malicious server (active) | withhold data, serve an old snapshot (detected via the client's monotonic `seq` floor), refuse service | inject keys (key material only travels through out-of-band secrets or verified safety codes), decrypt |
| Stolen/lost device | — | continue after revocation (tokens die, wrapped keys deleted, namespace key rotation re-encrypts) |
| Removed share member | keep what it already decrypted | read anything written after rotation |
| XSS in an app origin | use keys while running | exfiltrate raw key bytes (non-extractable `CryptoKey`s) |

### 4.2 Principles

- **No passwords anywhere.** Devices authenticate with P-256 ECDSA keys whose
  private halves are non-extractable. Admins administer via the CLI with
  filesystem access to the data directory, or the loopback-only admin page.
- **All secrets are 256-bit random**, compared in constant time, stored only as
  SHA-256 hashes (tokens, pairing codes, invite codes), single-use where
  applicable, short-lived (pairing 10 min, invites 7 days default, access
  tokens 10 min).
- **Least privilege**: account roles `admin | member | guest`; namespace roles
  `owner | editor | viewer`, enforced on every request.
- **Defense in depth**: strict input validation (lengths, charsets, JSON
  schemas), request body limits, header/request timeouts, per-IP and
  per-device token-bucket rate limits, security headers
  (`Strict-Transport-Security`, `X-Content-Type-Options`, `Referrer-Policy:
  no-referrer`, `Cache-Control: no-store`, CSP `default-src 'none'` on API),
  CORS allow-list (configured origins + origins learnt at pairing).
- **Tamper-evident audit log**: every security-relevant event is appended to a
  SHA-256 hash chain; `storage-server audit verify` detects edits/truncation.
- **Container hardening**: distroless non-root image, read-only root FS, one
  writable volume (`/data`), no shell.
- The server stores **only** ciphertext for anything user-authored. At-rest
  disk encryption of `/data` is recommended in the docs (metadata protection).

### 4.3 Cryptography

All encodings: base64url without padding (`b64u`) in JSON; raw bytes in bodies.

**Device keys** (generated on the device, private halves non-extractable,
kept in the `KeyVault`):
- `DSK` — ECDSA P-256 signing key (authentication).
- `DEK` — ECDH P-256 key-agreement key (receiving wrapped account keys).

**Account encryption key `AEK`** — ECDH P-256 key pair, one per account.
Namespaces are shared *to accounts*, so every namespace key is wrapped to an
account's AEK public key. The AEK private key is stored on the server only as:
- `recoveryWrap` — PKCS#8 sealed with `HKDF(RK, salt=accountId, info="oss-storage/v1/recovery")`.
- `deviceWraps[deviceId]` — PKCS#8 sealed to that device's DEK (ECDH-ES, below).

**Recovery key `RK`** — 32 random bytes, shown once as Crockford base32 in
groups of 4 (`XXXX-XXXX-…`, 52 chars + checksum char) and as a QR. Never sent
to the server. Entering it on a new device recovers everything.

**Namespace key `NK`** — 32 random bytes per namespace *epoch*. Wrapped to each
member account's AEK: `keys[epoch][accountId] = ECDH-ES(AEK_pub, NK)`.
Subkeys via `HKDF-SHA-256(NK, salt=utf8(namespaceId), info=…)`:
- `content` (AES-256-GCM) — file bodies, record values, metadata.
- `nameMac` (HMAC-SHA-256) and `nameEnc` (AES-256-GCM) — deterministic names.

**ECDH-ES wrap** (`oss-storage/v1/wrap`): ephemeral P-256 key pair; `Z = ECDH(eph_priv, recipient_pub)`;
`K = HKDF(Z, salt=eph_pub_raw, info="oss-storage/v1/wrap|"+context)`;
output `{ epk: b64u(raw eph pub), iv, ct }` (AES-256-GCM, AAD = context).
Contexts: `aek|<accountId>|<deviceId>`, `nk|<namespaceId>|<epoch>|<accountId>`.

**Secret-wrap** (out-of-band secrets `X`, used by device-to-device pairing and
invites): `code = HKDF(X, info="oss-storage/v1/code")` (sent to the server,
stored hashed), `K = HKDF(X, info="oss-storage/v1/key")` (never sent) seals the
payload (AEK private for pairing; NK epochs for invites).

**Content envelope `OSE1`** (binary):
```
"OSE1" (4) | version u8 = 1 | epoch u32 BE | iv (12) | AES-256-GCM(ciphertext ‖ tag 16)
```
AAD = `oss-storage/v1|<namespaceId>|<kind>|<locator>` where
`kind ∈ {file, meta, record, nsmeta}` and `locator` is the file id (files,
metadata) or `<collectionCipher>/<keyCipher>` (records) or empty (nsmeta).
The AAD binds a ciphertext to its place: a server that swaps two blobs or
two rows produces a decryption failure, never silently wrong data. The server
reads the 9-byte plaintext header to enforce "writes use the current epoch".

**Deterministic names** (per path segment, collection name, record key):
`iv = HMAC(nameMac, "seg|" + segment)[0..12]`,
`ct = AES-GCM(nameEnc, iv, segment, aad="name")`,
encoded `"<epoch base36>." + b64u(iv ‖ ct)`. Equal plaintexts map to equal
ciphertexts (prefix listing and lookups work); the server learns equality
only. Path = encrypted segments joined by `/`.

**File metadata** (sealed, kind `meta`): `{ path, id, size, mtime, mime?, tags?, app? }`
— the client verifies `path` and `id` on read, so a server-side move without a
matching sealed metadata update is detected.

**Monotonic floor**: the client persists the highest `seq` it has seen per
namespace; a response with a lower `seq` is treated as a rollback
(`RollbackError`).

### 4.4 Key storage on devices (`KeyVault`)

```ts
interface KeyVault {
  get(id: string): Promise<CryptoKey | Uint8Array | null>;
  put(id: string, value: CryptoKey | Uint8Array): Promise<void>;
  delete(id: string): Promise<void>;
  clear(prefix?: string): Promise<void>;
}
```
- **Web**: `createIndexedDbKeyVault()` stores `CryptoKey` objects (structured
  clone keeps them non-extractable). Raw secrets that must be re-wrapped later
  (AEK private for sharing new devices) are stored *wrapped* by a
  non-extractable AES-GCM vault key, never in `localStorage`.
- **Native**: `getNativeKeyVaultHost()` — a host installs
  `window.__ossKeyVault = { version: 1, get, put, delete, clear }` (bytes as
  b64u) backed by Keychain (`kSecAttrAccessibleWhenUnlockedThisDeviceOnly`),
  Android Keystore, or Secure Enclave–wrapped storage; announced with the
  `oss:key-vault-host` event. Values are imported as non-extractable keys.
- **Optional PIN lock**: `protectVault(vault, pin)` wraps entries with a
  PBKDF2-SHA-256 (600 000 iterations) derived key; composes with the
  framework's existing PIN lock UI.
- **Memory**: `createMemoryKeyVault()` for tests.

## 5. Data model

- **Account** `{ id, name, role, quotaBytes|null, createdAt, aekPublic?, recoveryWrap? }`
- **Device** `{ id, accountId, name, platform, dskPublic, dekPublic, createdAt, lastSeenAt, revokedAt? }`
- **Pairing** `{ id, codeHash, accountId | newAccount{name, role}, createdBy, expiresAt, usedAt?, transferBlob? }`
- **Namespace** `{ id, app, ownerAccountId, epoch, meta (OSE1 nsmeta), seq, createdAt, deletedAt? }`
  — `app` is a plaintext app id (e.g. `notes`) so each app lists its own
  namespaces; everything user-authored (name, glyph, color, slug) is in `meta`.
- **Member** `{ namespaceId, accountId, role }` + **KeyWrap** `{ namespaceId, epoch, accountId, wrap }`
- **Invite** `{ id, namespaceId, codeHash, role, createdBy, expiresAt, maxUses, uses, payload (secret-wrapped NK epochs) }`
- **File** `{ namespaceId, path (encrypted), fileId, rev, seq, size, blobHash, meta (OSE1), createdAt, updatedAt, deletedAt? }`
  + **FileRevision** history rows + trash (soft-deleted files).
- **Record** `{ namespaceId, collection (enc), key (enc), rev, seq, value (OSE1) | null (tombstone), updatedAt }`
- **Change feed**: every mutation bumps the namespace `seq`; an item's `rev` is
  the `seq` that last wrote it, rendered as the opaque string `"<seq>"`.
- **Blob**: content-addressed by SHA-256 of the ciphertext, ref-counted, GC'd.
- **AuditEvent** `{ id, at, actor, action, target, ip, detail, prevHash, hash }`

Retention (configurable): file history — last 20 revisions and 30 days;
trash — 30 days; record tombstones — 90 days (a client whose cursor predates
compaction gets `410 Gone` and resyncs).

## 6. HTTP API (`/v1`)

Conventions: JSON bodies (`application/json`) except file content
(`application/octet-stream`). Errors: `{ "error": { "code", "message", ...details } }`.
Revisions travel as `ETag: "<rev>"`; conditional writes use `If-Match: "<rev>"`
or `If-None-Match: *`. Auth: `Authorization: Bearer <token>`.

| Status | code | Client maps to |
|---|---|---|
| 400 | `invalid_request` | `Error` |
| 401 | `unauthenticated` | re-auth once, then `AuthError` |
| 403 | `forbidden` | `ForbiddenError` |
| 404 | `not_found` | `null` / `NotFoundError` |
| 409/412 | `conflict` (+ `current: {rev, …}`) | `ConflictError` |
| 410 | `cursor_expired` | full resync |
| 413 | `too_large` | `Error` |
| 429 | `rate_limited` (+ `Retry-After`) | `RateLimitError` |
| 507 | `quota_exceeded` | `QuotaExceededError` |

### 6.1 Server & auth
- `GET /v1/info` → `{ serverId, name, version, protocol: 1, capabilities[], time, tls: {mode, fp?} }` (public)
- `POST /v1/auth/challenge {deviceId}` → `{ challenge, expiresAt }`
- `POST /v1/auth/token {deviceId, challenge, signature}` → `{ token, expiresAt, accountId }`
  — signature: ECDSA-P256-SHA256 (IEEE P1363) over
  `oss-storage/v1/auth|<serverId>|<deviceId>|<challenge>`.
- `POST /v1/auth/logout` — revoke the current token.

### 6.2 Pairing & devices
- `POST /v1/pair {code, device:{name, platform, dskPublic, dekPublic}}` →
  `{ deviceId, accountId, serverId, account, transfer? }` (public, rate-limited;
  consumes the code; creates the account when the pairing says `newAccount`).
- `POST /v1/pairings {accountId?, newAccount?:{name, role}, ttlSeconds?, code?, transfer?}` →
  `{ pairingId, code?, expiresAt }` — a device may create a pairing for its own
  account (supplying `code = HKDF(X)` and the secret-wrapped AEK `transfer`);
  admins may create pairings for other/new accounts.
- `GET /v1/me` → account, devices, keys (`aekPublic`, `recoveryWrap`, this device's `deviceWrap`).
- `PUT /v1/me/keys {aekPublic, recoveryWrap, deviceWraps{deviceId: wrap}}` — first-time setup
  (only when unset) and later adding `deviceWraps`.
- `GET /v1/me/devices`, `PATCH /v1/devices/:id {name}`, `DELETE /v1/devices/:id` (revoke; admins any, members own).
- `GET /v1/me/pending-devices` → devices of this account without a `deviceWrap`, each with a
  6-digit **safety code** = `SHA-256(dskPublic ‖ dekPublic)` → decimal, shown on both devices for approval.

### 6.3 Namespaces, members, invites
- `GET /v1/namespaces?app=<id>` → `[{ id, app, role, epoch, meta, seq, keys: {epoch: wrap} }]`
- `POST /v1/namespaces {app, meta, wrap}` → namespace (creator is owner, epoch 1)
- `GET|PATCH|DELETE /v1/namespaces/:ns` (`PATCH {meta, ifSeq?}`; delete = owner, soft then purge)
- `GET /v1/namespaces/:ns/members`, `PATCH …/members/:accountId {role}`, `DELETE …/members/:accountId`
- `POST /v1/namespaces/:ns/invites {role, ttlSeconds, maxUses, code, payload}` → `{ inviteId, expiresAt }`
- `GET /v1/namespaces/:ns/invites`, `DELETE /v1/namespaces/:ns/invites/:id`
- `POST /v1/invites/accept {code, device?}` → `{ namespaceId, role, payload, deviceId?, accountId? }`
  — authenticated devices join with their account; unauthenticated callers must
  supply `device` and get a new **guest** account (the invite doubles as pairing).
- `POST /v1/namespaces/:ns/keys {epoch, wraps{accountId: wrap}}` — add wraps (owner/members adding themselves after invite).
- `POST /v1/namespaces/:ns/rotate {epoch: n+1, wraps{accountId: wrap}}` — owner; new writes must use `n+1`.

### 6.4 Files (`:path` = encrypted segments, URL-encoded)
- `GET /v1/ns/:ns/files?prefix=&recursive=1&cursor=&limit=` →
  `{ entries: [{ path, fileId, rev, size, meta, updatedAt }], cursor?, seq }`
- `GET /v1/ns/:ns/files/:path` → bytes, `ETag`, `X-File-Id`, `X-Meta` (b64u)
- `HEAD /v1/ns/:ns/files/:path` → headers only
- `PUT /v1/ns/:ns/files/:path` (`If-Match` / `If-None-Match: *` / none; headers
  `X-File-Id`, `X-Meta`) → `{ rev, seq, size }`; 412 with `current` on mismatch
- `DELETE /v1/ns/:ns/files/:path` (optional `If-Match`) → moves to trash (tombstone in feed)
- `POST /v1/ns/:ns/files:move {from, to, meta, ifMatch?, overwrite?}` / `files:copy {from, to, fileId, meta}`
- `GET /v1/ns/:ns/history/:path` → revisions; `POST /v1/ns/:ns/history:restore {path, rev, meta}`
- `GET /v1/ns/:ns/trash`, `POST /v1/ns/:ns/trash:restore {fileId}`, `DELETE /v1/ns/:ns/trash/:fileId`
- Large files: `POST /v1/ns/:ns/uploads` → `{ uploadId }`; `PUT …/uploads/:id/parts/:n`;
  `POST …/uploads/:id:commit {path, fileId, meta, ifMatch?}`; `DELETE …/uploads/:id`.

### 6.5 Records (rows / key-value)
- `GET /v1/ns/:ns/records/:collection?cursor=&limit=&includeDeleted=1` → `{ records: [{ key, rev, value|null, updatedAt }], cursor?, seq }`
- `GET|PUT|DELETE /v1/ns/:ns/records/:collection/:key` — `PUT` body `{ value }` (b64u OSE1), `If-Match` / `If-None-Match: *`
- `POST /v1/ns/:ns/batch {atomic, ops[]}` — ops:
  `{op:"put", collection, key, value, ifRev?|ifAbsent?}`, `{op:"delete", collection, key, ifRev?}`,
  `{op:"check", collection, key, rev}`, `{op:"file.delete", path, ifRev?}`, `{op:"file.put", path, fileId, meta, content(b64u ≤ 1 MiB), ifRev?|ifAbsent?}`.
  `atomic:true` → all-or-nothing (409 lists failing ops with current revs);
  `atomic:false` → per-op `{ ok, rev } | { ok:false, error, current }`.

### 6.6 Change feed & live events
- `GET /v1/ns/:ns/changes?since=<seq>&limit=&wait=<≤30s>` →
  `{ seq, changes: [{ kind: "file"|"record"|"namespace"|"members", …, rev, deleted }], more }`
  (long-poll when `wait` > 0 and nothing new).
- `GET /v1/events` — Server-Sent Events over `fetch` (bearer header):
  `event: ns` `{ ns, seq }`, `event: namespaces` (membership changed),
  `event: device` (this device revoked), heartbeat comment every 25 s.

### 6.7 Admin (role `admin`)
- `GET|POST /v1/admin/accounts`, `PATCH|DELETE /v1/admin/accounts/:id {name, role, quotaBytes}`
- `GET /v1/admin/audit?since=` , `GET /v1/admin/stats`

### 6.8 Test mode only (`--test-mode`, header `X-Test-Secret`)
- `POST /__test/reset`, `GET /__test/snapshot`, `POST /__test/restore`
- `POST /__test/faults {rules[]}` — `{match:{method?, path?}, action:"offline"|"status"|"delay", status?, retryAfter?, delayMs?, times?}`; `DELETE /__test/faults`
- `POST /__test/clock {set?|advanceMs?}`
- `POST /__test/accounts {name, role}` → `{ accountId, pairingCode }`

## 7. Conflict resolution

1. **Files** — atomic compare-and-swap on the server (`If-Match`). The
   framework `StorageAdapter` maps 412 to `ConflictError(remote)` with the
   current bytes, so existing app merge code works and is now race-free.
2. **Records** — each row has its own `rev`; a stale write fails for that row
   only. The `RecordStore` keeps each row's **base** (last synced value) and
   resolves with `mergeValues(base, local, remote)`:
   - plain objects merge **per field** recursively (3-way);
   - a field changed on one side takes that side;
   - a field changed on both sides → `resolve` hook, default: the side whose
     row `updatedAt` (or a configured field) is newer, ties → remote;
   - arrays are values (3-way on the whole array), or unions via
     `arrayStrategy: "union"`;
   - edit vs delete → the edit wins (configurable), recorded via tombstones so
     deletions no longer resurrect.
3. **Row documents** — `createRowDocumentAdapter` lets a single-document app
   (meds, period, baby, time, calendar) keep `save(text)`/`load()`: the JSON
   document is split into rows by configured map paths (e.g.
   `medications`, `days`), only changed rows are pushed, conflicts resolve per
   row automatically, and `load()` reassembles the document. `ConflictError`
   surfaces only if a custom resolver refuses.

## 8. Framework client (`oss-framework/storage/selfhosted`)

```ts
const vault = await createIndexedDbKeyVault({ name: "notes" });
const client = createSelfHostedClient({ vault, fetchImpl? });
await client.pair(parsePairingPayload(scanned), { name: "Pixel 9", platform: "web" }); // enrols device
await client.setupAccountKeys();           // first device: creates AEK + returns recovery key to show once
// or: await client.recover(recoveryKey)    // new device without another device at hand
const ns = await client.createNamespace({ app: "meds", meta: { name: "Me" } });
const store = ns.fileStore();              // framework FileStore (drop-in for Dropbox)
const adapter = ns.adapter({ fileName: "meds.json" });            // StorageAdapter, CAS + watch
const rows = ns.records("days", { merge });                        // row-level RecordStore
const doc = ns.rowDocumentAdapter({ fileName: "meds.json", rows: ["medications", "days"] });
const invite = await ns.invite({ role: "viewer" });                // → QR payload
await client.acceptInvite(parseInvitePayload(scanned));
await ns.removeMember(accountId, { rotate: true });
const pairing = await client.createDevicePairing();               // device-to-device QR (carries key transfer)
```

- `StorageBackendId` gains `"selfhosted"`.
- Errors: reuses `ConflictError`, `AuthError`, `RateLimitError`; adds
  `ForbiddenError`, `QuotaExceededError`, `RollbackError`, `DecryptError`.
- `src/qr/`: `encodeQr(text, {ecl})` → module matrix, `qrToSvg`, `<QrCode value>`.

## 9. Pairing & QR payloads

- Server-created (console/admin page/CLI): `oss-storage://pair?v=1&s=<server URL>&c=<code>&n=<server name>[&fp=<sha256 SPKI b64u>]`
  — enrols the device only; keys come from recovery key or approval by an
  existing device (safety-code comparison).
- Device-created (existing device shows it): `oss-storage://pair?v=1&s=<url>&x=<secret X>`
  — the server only ever sees `HKDF(X,"code")`; the AEK travels sealed under
  `HKDF(X,"key")`. MITM-proof by construction.
- Invite: `oss-storage://invite?v=1&s=<url>&x=<secret X>&r=<role>`.
- Any payload may be wrapped as an app link `<appUrl>#oss=<b64u(payload)>`
  (server option `--app-url`) so a phone camera opens the right app directly.
- Rendered as: terminal QR (CLI / startup), SVG (`GET /admin/pairings/:id.svg`
  on the loopback admin page), and `<QrCode>` in apps (framework `src/qr`).

## 10. Networking & TLS

- Listeners: HTTPS `:8443` (configurable; 443 when mapped), optional HTTP `:8080`
  used only for ACME http-01 + redirect, loopback admin `127.0.0.1:8081`.
- `tls.mode`:
  - `acme` — RFC 8555 client (ES256 account key, `http-01` and `tls-alpn-01`),
    identifiers `dns` or `ip` (short-lived profile for IP certs), renewal at
    one third of remaining lifetime, hot-reload via `setSecureContext`.
  - `files` — PEM paths, reloaded on change.
  - `self-signed` — generated P-256 cert; QR carries `fp` for native pinning.
  - `off` — plain HTTP for a reverse proxy/tunnel; binds 127.0.0.1 unless `--listen` says otherwise; `--trust-proxy` for `X-Forwarded-For`.
- Port mapping: UPnP IGD (SSDP discovery → WANIPConnection/WANPPPConnection
  SOAP `AddPortMapping`, `GetExternalIPAddress`, `DeletePortMapping`, lease
  renewal) with NAT-PMP fallback; CGNAT/private external IP detection with an
  actionable warning. `storage-server doctor` checks mapping, reachability and
  certificate.

## 11. CLI (`storage-server`)

`serve` (default) · `setup` · `pair` · `accounts {list,create,update,delete}` ·
`devices {list,revoke}` · `namespaces list` · `audit {verify,tail}` ·
`backup` · `cert {status,renew}` · `upnp {status,map,unmap}` · `doctor` ·
`test-server` · plus OSS_SPEC §12 discoverability: `--help-agent`,
`--debug-agent`, `commands [name] [--examples]`, `docs [topic]`, `man [cmd]`.
Configuration precedence: flags > env (`STORAGE_*`) > `config.json` in the
data dir > defaults. Logging per OSS_SPEC §19 (`status/warn/info/header/error`
+ always-on debug log file, `--debug` to stderr).

## 12. Testkit (`@niclaslindstedt/storage-testkit`)

```ts
const server = await startTestServer();            // in-process, memory DB, random port, test mode
const alice = await server.createAccount("alice"); // → { accountId, pairingPayload }
await server.faults.add({ match: { path: "/v1/ns/" }, action: "status", status: 503, times: 2 });
await server.faults.offline(); await server.faults.clear();
await server.clock.advance(15 * 60_000);
const snap = await server.snapshot(); await server.restore(snap); await server.reset();
await server.close();
// Playwright: startTestServerProcess() spawns `storage-server test-server` and returns the same API over HTTP.
// Optional (peer: oss-framework): pairClient(server, alice) → ready SelfHostedClient; seed(ns, {files, records}).
```

## 13. Testing strategy

- **TDD**: interface → failing test → implementation, per module.
- Server: unit tests per module (`packages/server/tests/*_test.ts`, Vitest)
  including QR (decoded with `jsqr`), ASN.1/CSR/X.509 (parsed with
  `crypto.X509Certificate`), ACME against an in-process fake ACME CA, UPnP
  against a fake IGD, NAT-PMP against a fake gateway, and HTTP API tests
  against the in-process server.
- Framework: unit tests (`tests/storage-selfhosted-*.test.ts`) for crypto,
  merge, vault, payloads, record engine, adapters with mocked transport.
- **e2e** (`e2e/tests/*_test.ts`): the real framework client against the real
  server over HTTP(S): pairing flows, recovery, device approval, sharing and
  revocation with rotation, conflicts (files CAS, row merge, concurrent
  devices), offline/faults, change feed + SSE, quotas, history/trash, and
  app-shaped scenarios (meds single doc → row document, contacts binary
  photos + large uploads, notes many files + moves, calendar per-namespace).

## 14. Non-functional requirements

- Zero runtime dependencies in `packages/server` (dev deps only).
- Every source file < 1000 lines (OSS_SPEC §20.5); tests in `tests/` named `*_test.ts`.
- `make build test lint fmt-check` green; framework `make lint test build fmt-check size` green.
- Docker image runs as non-root, `HEALTHCHECK` via `/v1/info`.

## 15. Progress (resume here)

Legend: `[ ]` todo · `[~]` in progress · `[x]` done.

### Server (`packages/server`)
- [ ] S1 workspace scaffolding (tsconfig, vitest, eslint, prettier, Makefile)
- [ ] S2 clock, ids, random, config, logging (§19)
- [ ] S3 database schema + migrations (`node:sqlite`), blob store (fs + memory)
- [ ] S4 HTTP core: router, validation, errors, CORS, security headers, rate limits, body limits
- [ ] S5 auth: challenge/token, device signature verify, token store
- [ ] S6 accounts, devices, pairing (server- and device-created), keys, pending devices
- [ ] S7 namespaces, members, invites, key wraps, rotation, epoch enforcement
- [ ] S8 files: CAS put/get/head/delete, list (prefix/recursive/cursor), move/copy, history, trash, uploads, quotas
- [ ] S9 records: get/put/delete/list, batch (atomic / per-op), tombstones
- [ ] S10 change feed (+ long-poll), SSE events hub
- [ ] S11 audit log hash chain + verify
- [ ] S12 retention / GC jobs (history, trash, tombstones, blobs, expired pairings/invites/tokens)
- [ ] S13 admin API
- [ ] S14 test mode (reset, snapshot/restore, faults, clock, accounts)
- [ ] S15 QR encoder + terminal/SVG renderers
- [ ] S16 ASN.1 DER, CSR, self-signed certs; TLS manager (files/self-signed/off)
- [ ] S17 ACME client (http-01, tls-alpn-01, dns/ip identifiers) + fake CA tests
- [ ] S18 UPnP IGD + NAT-PMP + CGNAT detection
- [ ] S19 CLI (all commands + §12 discoverability) and loopback admin page
- [ ] S20 Dockerfile, compose.yaml, healthcheck

### Framework (`oss-framework`)
- [ ] F1 `src/qr` encoder + SVG + `<QrCode>`
- [ ] F2 selfhosted crypto (envelopes, names, wraps, recovery key)
- [ ] F3 KeyVault (memory, IndexedDB non-extractable, native host, PIN protect)
- [ ] F4 transport (auth, retries, error mapping, SSE parser)
- [ ] F5 client: pairing, account keys, recovery, device approval, device pairing
- [ ] F6 namespaces, sharing (invites, members, rotation + re-encryption)
- [ ] F7 FileStore + StorageAdapter (CAS, watch, probe, getRevision)
- [ ] F8 merge (3-way), RecordStore, row-document adapter
- [ ] F9 README, subpath exports, size budgets, changeset fragment, lint/test/build/size green

### Testkit & e2e
- [ ] T1 `startTestServer` (in-process) + `startTestServerProcess` (subprocess) + helpers
- [ ] T2 e2e: pairing / recovery / approval
- [ ] T3 e2e: files CAS, history, trash, uploads, quotas
- [ ] T4 e2e: records + row documents + concurrent devices
- [ ] T5 e2e: sharing, revocation, rotation
- [ ] T6 e2e: faults/offline, change feed, SSE watch
- [ ] T7 e2e: app-shaped scenarios (meds, contacts, notes, calendar)

### Repository (OSS_SPEC)
- [ ] R1 root files (LICENSE, README, CONTRIBUTING, COC, SECURITY, AGENTS + symlinks, CHANGELOG, .gitignore, .editorconfig, Makefile)
- [ ] R2 .github (workflows ci/version-bump/release/pages/seo/lighthouse, templates, dependabot, CODEOWNERS)
- [ ] R3 docs/, man/, examples/, prompts/, scripts/, .agents/skills/
- [ ] R4 website/ (SEO scaffolding)
- [ ] R5 `scripts/validate.sh` from oss-spec reports no structural violations
