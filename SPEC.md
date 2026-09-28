# storage — specification

> The authoritative design for the self-hosted, end-to-end-encrypted storage
> backend and its client module in `@niclaslindstedt/oss-framework`. If work is
> interrupted, **resume from §15 (Progress)** — every task there points at the
> section that defines it.

- Status: **in development** — server, framework client (niclaslindstedt/oss-framework#162), testkit and e2e done; reference app and OSS_SPEC repository work in progress
- Spec version: 1.0.0 (2026-09-27)
- Owner: Niclas Lindstedt

---

## 0. Decisions log

| #   | Decision             | Chosen                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Why                                                                                                                                                                                                                                                                                                                  |
| --- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Server language      | **TypeScript on Node ≥ 22**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Same language as every app and the framework; the real server runs in-process inside Vitest/Playwright; zero runtime dependencies (`node:http`, `node:crypto`, `node:sqlite`).                                                                                                                                       |
| D2  | Tenancy              | **Household server**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | One admin, several accounts (family), guests invited to single namespaces; open sign-up off by default; per-account quotas.                                                                                                                                                                                          |
| D3  | TLS at home          | **Built-in ACME** (Let's Encrypt; DNS name _or_ bare public IP via short-lived IP certificates) + UPnP/NAT-PMP port mapping; also `files`, `self-signed` (native-only, pinned), and `off` (behind a reverse proxy / tunnel).                                                                                                                                                                                                                                                                                                                                                                                                                       | Browser PWAs cannot pin a self-signed certificate; they need a publicly trusted one.                                                                                                                                                                                                                                 |
| D4  | Scope of this round  | **Server + framework client module + testkit + full-stack e2e tests.** Apps adopt it in a follow-up.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Answer to the scope question. Healthcare apps (meds, period, baby) are first-class targets: the design must satisfy them (see §2).                                                                                                                                                                                   |
| D5  | Encryption           | **Zero-knowledge end-to-end encryption, mandatory.** The server never holds a key that decrypts content, names, or metadata.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Healthcare data. The hoster (even the admin) sees only ciphertext and structure.                                                                                                                                                                                                                                     |
| D6  | Client key storage   | **`KeyVault`** seam: IndexedDB holding _non-extractable_ `CryptoKey`s on the web; a native host (`window.__ossKeyVault`, Keychain / Android Keystore / Secure Enclave) in wrappers.                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Keys must be safe on the device too, not only on the server.                                                                                                                                                                                                                                                         |
| D7  | Conflict granularity | **Row level** (records) with automatic field-level 3-way merge; atomic compare-and-swap for files.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | The apps' current check-then-write races and whole-document "keep mine/theirs" lose data.                                                                                                                                                                                                                            |
| D8  | Crypto primitives    | WebCrypto only: **P-256** ECDSA/ECDH, HKDF-SHA-256, AES-256-GCM, HMAC-SHA-256, PBKDF2 only for optional vault PINs.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Available in every browser, Node, and native WebView; FIPS-approved algorithms (healthcare-friendly).                                                                                                                                                                                                                |
| D9  | Storage engine       | SQLite (`node:sqlite`, WAL) for metadata + content-addressed blob directory. `:memory:` + in-memory blobs for tests.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | One implementation for production and tests; no native addons.                                                                                                                                                                                                                                                       |
| D10 | License              | PolyForm-Noncommercial-1.0.0                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Matches the sibling repos.                                                                                                                                                                                                                                                                                           |
| D11 | Out of scope         | Server-side search / thumbnails (server cannot read data); federation between servers.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | E2EE makes them impossible or a leak.                                                                                                                                                                                                                                                                                |
| D13 | Remote admin         | **Admin devices**: a device of an admin account, paired with a console pairing minted only by the local console or the CLI, may call the console's own API at `/v1/console` with its device token. The **Storage Remote** app (web + Expo wrapper) mounts the console's pages over it and adds an E2EE drive. See §11.2.                                                                                                                                                                                                                                                                                                                           | The hoster wants to administer and use the server from a phone. Granting at the machine keeps D12's rule that nothing remote can create admin access; one API keeps the phone and the console identical.                                                                                                             |
| D14 | Headless admin CLI   | **`storage` (`packages/cli`), a separate zero-dependency CLI** over the console API — the admin token on the console listener, or an admin device (§11.2) at `/v1/console` with its own key — with contexts, `.env` / environment credentials and a `storage-cli` image. See §11.3.                                                                                                                                                                                                                                                                                                                                                                | Operators script and automate from CI, cron and containers, and from machines other than the server's; one API keeps the CLI, the console and the phone identical, and no new server surface is added.                                                                                                               |
| D12 | Admin console        | **Local web console on its own listener** (default `127.0.0.1:8081`), a dependency-free TypeScript SPA embedded in the server. Stable admin token in `<data-dir>/admin.token` (0600) → session cookie. See §11.1.                                                                                                                                                                                                                                                                                                                                                                                                                                  | Operators need to administer, monitor, read logs and troubleshoot without a shell; the console must add no remote attack surface and no runtime dependency.                                                                                                                                                          |
| D15 | AI agents (MCP)      | **`storage-mcp`: a zero-dependency MCP server (stdio; MCP 2026-07-28 + 2024-11-05…2025-11-25) that is a client like any app, paired as an _agent device_**: a device whose pairing carried a scope (permissions + apps) that the server enforces on every request, narrowable never widenable. On top: a local tool policy, human confirmation via MCP elicitation (HMAC-sealed single-use `requestState`), no tool that hands out keys or credentials (pairing, approval, invites, recovery keys are person-only terminal commands), fenced untrusted content, one-origin TLS with pinning, an encrypted key vault, a local audit log. See §11.4. | Parity with the console and Storage Remote for agents without trusting the model: prompt injection (the "lethal trifecta") is assumed, so the server — not the agent's own config — bounds what it can do, and a person — not the model — confirms what cannot be undone.                                            |
| D16 | Web drive, versions  | **The web drive (`apps/drive`), published on the website at `/storage/drive/`**: a static page on the framework client that signs a browser in by pairing and reuses Storage Remote's file pages; live sync from `/v1/events` + the change feed. **Version history is a runtime setting**: every overwrite keeps the replaced version for `historyDays` (default 30) after it was replaced, at most `historyCount` (default 100); console Settings / `storage settings` / MCP, stored in `settings`, over the configuration. Text diffs are computed on the device. See §11.5.                                                                     | People want Dropbox in a browser and their old versions back. A page on the website is independent of the server (a malicious server cannot change it), and a static build can be hosted anywhere. The server cannot read versions, so it cannot compare them; retention must be a knob because versions cost quota. |

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

| App                         | Layout today                                                                             | Conflict handling today                        | Needs                                                                                                              |
| --------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| meds, period, baby (health) | one encrypted JSON doc (`oss.encrypted.v1`)                                              | merge per record by `updatedAt`, no tombstones | row-level merge, tombstones, E2EE, iCloud is banned for health data → **this backend is their recommended remote** |
| time                        | one JSON doc                                                                             | merge per record by `updatedAt`                | row-level merge                                                                                                    |
| calendar                    | one JSON doc per calendar (`/<slug>/calendar.json`)                                      | remote wins (drops local edit)                 | CAS + merge, synced calendar registry                                                                              |
| contacts                    | one JSON doc per namespace + binary photos/attachments + atlas zips                      | whole-doc, remote wins                         | binary files, large uploads, per-namespace isolation (today one namespace's prune can delete another's photos)     |
| notes                       | one markdown file per note + sidecars + binary attachments, encrypted filenames optional | whole-doc keep mine/theirs, 10 s polling       | recursive list with revs, cheap incremental listing, push instead of polling, move/rename                          |
| calc                        | one markdown file per session                                                            | none (last writer wins)                        | CAS per file                                                                                                       |
| checklist                   | one markdown file per item (vendored storage)                                            | aggregate rev, keep mine/theirs                | CAS, change feed                                                                                                   |

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
packages/cli/        @niclaslindstedt/storage-cli      (headless admin CLI `storage`, §11.3)
packages/mcp/        @niclaslindstedt/storage-mcp      (MCP server for AI agents, an agent device — §11.4)
apps/reference/      reference PWA on oss-framework, built to be tested end to end (Playwright)
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

| Adversary                                            | Can                                                                                                    | Cannot                                                                                                                                           |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Hoster / server admin / attacker with the disk or DB | see account & device names, namespace count, app ids, sizes, timestamps, tree shape, access patterns   | read content, file names, record keys, namespace names, metadata; forge a device; swap/move ciphertext undetected; decrypt after a key rotation  |
| Network attacker                                     | see TLS metadata                                                                                       | read or modify traffic (TLS 1.2+, HSTS; native wrappers may also pin via the QR `fp`)                                                            |
| Malicious server (active)                            | withhold data, serve an old snapshot (detected via the client's monotonic `seq` floor), refuse service | inject keys (key material only travels through out-of-band secrets or verified safety codes), decrypt                                            |
| Stolen/lost device                                   | —                                                                                                      | continue after revocation (tokens die, wrapped keys deleted, namespace key rotation re-encrypts)                                                 |
| Removed share member                                 | keep what it already decrypted                                                                         | read anything written after rotation                                                                                                             |
| XSS in an app origin                                 | use keys while running                                                                                 | exfiltrate raw key bytes (non-extractable `CryptoKey`s)                                                                                          |
| Prompt-injected AI agent (`storage-mcp`, §11.4)      | do what its device's scope and the local policy allow, within the apps it was given                    | exceed its scope (server-enforced), confirm for the person, read a secret it minted, reach another host, widen its own or a child device's scope |

### 4.2 Principles

- **No passwords anywhere.** Devices authenticate with P-256 ECDSA keys whose
  private halves are non-extractable. Admins administer via the CLI with
  filesystem access to the data directory, or the admin console (§11.1),
  which listens on loopback by default and is unlocked by a token stored in
  the data directory. Remotely, only an **admin device** (§11.2) can
  administer, and only the local console or the CLI can make one.
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
Namespaces are shared _to accounts_, so every namespace key is wrapped to an
account's AEK public key. The AEK private key is stored on the server only as:

- `recoveryWrap` — PKCS#8 sealed with `HKDF(RK, salt=accountId, info="oss-storage/v1/recovery")`.
- `deviceWraps[deviceId]` — PKCS#8 sealed to that device's DEK (ECDH-ES, below).

**Recovery key `RK`** — 32 random bytes, shown once as Crockford base32 in
groups of 4 (`XXXX-XXXX-…`, 52 chars + checksum char) and as a QR. Never sent
to the server. Entering it on a new device recovers everything.

**Namespace key `NK`** — 32 random bytes per namespace _epoch_. Wrapped to each
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
`kind ∈ {file, meta, record, nsmeta}` and `locator` is the random content
id `cid` (file bodies — `cid` lives in the sealed metadata, so copies and
moves keep decrypting), the encrypted path (file metadata),
`<collectionCipher>/<keyCipher>` (records), or empty (nsmeta).
The AAD binds a ciphertext to its place: a server that swaps two blobs or
two rows produces a decryption failure, never silently wrong data. The server
reads the 9-byte plaintext header to enforce "writes use the current epoch".

**Deterministic names** (per path segment, collection name, record key):
`iv = HMAC(nameMac, "seg|" + segment)[0..12]`,
`ct = AES-GCM(nameEnc, iv, segment, aad="name")`,
encoded `"<epoch base36>." + b64u(iv ‖ ct)`. Equal plaintexts map to equal
ciphertexts (prefix listing and lookups work); the server learns equality
only. Path = encrypted segments joined by `/`.

**File metadata** (sealed, kind `meta`, bound to the encrypted path):
`{ v: 1, path, cid, size, mtime, mime?, tags? }` — the client checks `path` on
read; a server that moves or swaps metadata or blobs causes a decryption
failure. File ids are assigned by the server and survive overwrites and moves.

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
  (AEK private for sharing new devices) are stored _wrapped_ by a
  non-extractable AES-GCM vault key, never in `localStorage`.
- **Native**: `getNativeKeyVaultHost()` — a host installs
  `window.__ossKeyVault = { version: 1, get, put, delete, clear }` (bytes as
  b64u) backed by Keychain (`kSecAttrAccessibleWhenUnlockedThisDeviceOnly`),
  Android Keystore, or Secure Enclave–wrapped storage; announced with the
  `oss:key-vault-host` event. Values are imported as non-extractable keys.
- **Local caches**: `client.localCacheKey()` is a non-extractable AES-GCM key
  in the vault; `createIdbRecordCache({ encryptWith })` keeps row caches
  encrypted at rest. App locks use the framework's existing PIN lock UI.
- **What is stored**: device private keys, the account private key and
  namespace subkeys — never raw bytes on the web (the account key's bytes are
  reconstructed transiently from the device's sealed copy when a device must
  be added).
- **Memory**: `createMemoryKeyVault()` for tests.

## 5. Data model

- **Account** `{ id, name, role, quotaBytes|null, createdAt, aekPublic?, recoveryWrap? }`
- **Device** `{ id, accountId, name, platform, dskPublic, dekPublic, console, scope?, createdAt, lastSeenAt, revokedAt? }`
  — `console`: an admin device (§11.2); effective only while the account is an admin.
  `scope`: an agent device's `{perms, apps}` (§11.4); null for ordinary devices.
- **Pairing** `{ id, codeHash, accountId | newAccount{name, role}, createdBy, expiresAt, usedAt?, transferBlob?, console, scope? }`
- **Namespace** `{ id, app, ownerAccountId, epoch, meta (OSE1 nsmeta), seq, createdAt, deletedAt? }`
  — `app` is a plaintext app id (e.g. `notes`) so each app lists its own
  namespaces; everything user-authored (name, glyph, color, slug) is in `meta`.
- **Member** `{ namespaceId, accountId, role }` + **KeyWrap** `{ namespaceId, epoch, accountId, wrap }`
- **Invite** `{ id, namespaceId, codeHash, role, createdBy, expiresAt, maxUses, uses, payload (secret-wrapped NK epochs) }`
- **File** `{ namespaceId, path (encrypted), fileId, rev, seq, size, blobHash, meta (OSE1), createdAt, updatedAt, deletedAt? }`
  - **FileRevision** history rows + trash (soft-deleted files).
- **Record** `{ namespaceId, collection (enc), key (enc), rev, seq, value (OSE1) | null (tombstone), updatedAt }`
- **Change feed**: every mutation bumps the namespace `seq`; an item's `rev` is
  the `seq` that last wrote it, rendered as the opaque string `"<seq>"`.
- **Blob**: content-addressed by SHA-256 of the ciphertext, ref-counted, GC'd.
- **AuditEvent** `{ id, at, actor, action, target, ip, detail, prevHash, hash }`

Retention (configurable, and at runtime by an admin — §11.1 Settings): file
history — every replaced version for 30 days after it was replaced, at most
100 per file;
trash — 30 days; record tombstones — 90 days (a client whose cursor predates
compaction gets `410 Gone` and resyncs).

## 6. HTTP API (`/v1`)

Conventions: JSON bodies (`application/json`) except file content
(`application/octet-stream`). Errors: `{ "error": { "code", "message", ...details } }`.
Revisions travel as `ETag: "<rev>"`; conditional writes use `If-Match: "<rev>"`
or `If-None-Match: *`. Auth: `Authorization: Bearer <token>`.

| Status  | code                               | Client maps to                 |
| ------- | ---------------------------------- | ------------------------------ |
| 400     | `invalid_request`                  | `Error`                        |
| 401     | `unauthenticated`                  | re-auth once, then `AuthError` |
| 403     | `forbidden`                        | `ForbiddenError`               |
| 404     | `not_found`                        | `null` / `NotFoundError`       |
| 409/412 | `conflict` (+ `current: {rev, …}`) | `ConflictError`                |
| 410     | `cursor_expired`                   | full resync                    |
| 413     | `too_large`                        | `Error`                        |
| 429     | `rate_limited` (+ `Retry-After`)   | `RateLimitError`               |
| 507     | `quota_exceeded`                   | `QuotaExceededError`           |

### 6.1 Server & auth

- `GET /v1/info` → `{ serverId, name, version, protocol: 1, capabilities[], time, tls: {mode, fp?}, retention: {historyDays, historyCount, trashDays} }` (public)
- `POST /v1/auth/challenge {deviceId}` → `{ challenge, expiresAt }`
- `POST /v1/auth/token {deviceId, challenge, signature}` → `{ token, expiresAt, accountId }`
  — signature: ECDSA-P256-SHA256 (IEEE P1363) over
  `oss-storage/v1/auth|<serverId>|<deviceId>|<challenge>`.
- `POST /v1/auth/logout` — revoke the current token.

### 6.2 Pairing & devices

- `POST /v1/pair {code, device:{name, platform, dskPublic, dekPublic}}` →
  `{ deviceId, accountId, serverId, account, transfer?, console }` (public, rate-limited;
  consumes the code; creates the account when the pairing says `newAccount`;
  `console` when it enrolled an admin device).
- `POST /v1/pairings {accountId?, newAccount?:{name, role}, ttlSeconds?, code?, transfer?, agent?:{perms, apps}}` →
  `{ pairingId, code?, expiresAt }` — a device may create a pairing for its own
  account (supplying `code = HKDF(X)` and the secret-wrapped AEK `transfer`);
  admins may create pairings for other/new accounts. `console: true` is refused
  here for everyone (403): admin devices are paired at the machine (§11.2).
  `agent` scopes the device it enrols (§11.4); a scoped caller mints only
  for its own account and never wider than itself.
- `GET /v1/me` → account, `console` (this is an admin device), `agent` (an agent device's scope, or null), keys (`aekPublic`, `recoveryWrap`, this device's `deviceWrap`).
- `PUT /v1/me/keys {aekPublic, recoveryWrap, deviceWraps{deviceId: wrap}}` — first-time setup
  (only when unset) and later adding `deviceWraps`.
- `GET /v1/me/devices`, `PATCH /v1/devices/:id {name}`, `DELETE /v1/devices/:id` (revoke; admins any, members own).
- `GET /v1/me/pending-devices` → devices of this account without a `deviceWrap`, each with a
  25-digit **safety code** (five groups of five) from `SHA-256(dskPublic ‖ dekPublic)`; the approving
  device recomputes it locally from the keys it will wrap to, never trusting the server's copy.

### 6.3 Namespaces, members, invites

- `GET /v1/namespaces?app=<id>` → `[{ id, app, role, epoch, meta, seq, keys: {epoch: wrap} }]`
- `POST /v1/namespaces {id?, app, meta, wrap}` → namespace (creator is owner, epoch 1; the client chooses `id` because it salts the key derivation)
- `GET|PATCH|DELETE /v1/namespaces/:ns` (`PATCH {meta}` with optional `If-Match`; delete = owner, immediate)
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
  — every write adds a version; a replaced version is kept for `historyDays`
  after the write that replaced it (its age counts from then, not from its own
  write), at most `historyCount` per file; the live and a trashed file's last
  version are always kept. A `files:move` with `overwrite` trashes the target.
- `GET /v1/ns/:ns/trash`, `POST /v1/ns/:ns/trash:restore {fileId}`, `DELETE /v1/ns/:ns/trash/:fileId`
- Large files: `POST /v1/ns/:ns/uploads` → `{ uploadId }`; `PUT …/uploads/:id/parts/:n`;
  `POST …/uploads/:id/commit {path, meta, ifMatch?, ifNoneMatch?}`; `DELETE …/uploads/:id`.

### 6.5 Records (rows / key-value)

- `GET /v1/ns/:ns/collections` → encrypted collection names with live row counts

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
- `GET|POST|PATCH|DELETE /v1/console/*rest` — the admin console's API (§11.1,
  `/api/<rest>`; `prometheus` → `/metrics`) for admin devices only (§11.2): 403 for
  any other device, 404 with `remoteConsole: false`. `/v1/info` lists the
  `console` capability when it is mounted and on.

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
  used only for ACME http-01 + redirect, admin console `127.0.0.1:8081`
  (§11.1; `--admin-host`, `--admin-port -1` disables it).
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
`health` · `test-server` · plus OSS_SPEC §12 discoverability: `--help-agent`,
`--debug-agent`, `commands [name] [--examples]`, `docs [topic]`, `man [cmd]`.
Configuration precedence: flags > env (`STORAGE_*`) > `config.json` in the
data dir > defaults. Logging per OSS_SPEC §19 (`status/warn/info/header/error`

- always-on debug log file, `--debug` to stderr).

### 11.1 Admin console

`serve` starts a second, separate HTTP listener: a web console to
administer, monitor, read logs and troubleshoot the server. It never shares
a port, a cookie or a code path with the device API.

**Binding and exposure.** `--admin-host` (default `127.0.0.1`, also in the
Docker image) and `--admin-port` (default `8081`, `-1` disables). A
non-loopback host logs a warning and fails the exposure check: the console
speaks plain HTTP, so it must only be published on a host's loopback or
reached through an SSH tunnel. In Docker with host networking (UPnP) the
default already means the host's loopback; with bridged networking the
operator opts in with `STORAGE_ADMIN_HOST=0.0.0.0` and publishes
`-p 127.0.0.1:8081:8081`. The image never defaults to `0.0.0.0`, because with
host networking that would expose the console to the LAN.

**Authentication.**

- The admin token is 256-bit random, created on first start in
  `<data-dir>/admin.token` (mode 0600; in-memory servers keep it in memory)
  and reused across restarts, so a Prometheus scrape config or a bookmark
  keeps working. Whoever can read the data directory is already an admin
  (§4.2), so the file adds no new trust. `storage-server admin` prints the
  sign-in URL; `storage-server admin --rotate` replaces the token and
  invalidates every session.
- The token is never written to the log file. `serve` prints the sign-in
  link to stderr only when attached to a terminal (not into a journal or
  container log); otherwise it points at `storage-server admin`.
- `GET /login?token=…` (or the login form, `POST /login`) exchanges the
  token for a session: 256-bit id, stored hashed in memory, `HttpOnly;
SameSite=Strict; Path=/` cookie, 12 h absolute / 1 h idle lifetime, bound to
  the token it was issued under (rotation kills it). The response redirects
  to `/` so the token leaves the address bar and history.
- Scripts and Prometheus use `Authorization: Bearer <token>` instead.
- Login attempts are rate limited (10/min per client) and compared in
  constant time.

**Browser hardening.**

- DNS-rebinding guard: the `Host` header's name must be an IP literal or
  `localhost` (a rebinding attack needs a domain name). Anything else is
  `421 Misdirected Request`.
- CSRF: state-changing requests (`POST`/`PATCH`/`DELETE`) authenticated by
  cookie must carry `X-Storage-Admin: 1` (not settable cross-origin without
  a preflight, which is never granted) and, when present, an `Origin` equal
  to the console's own origin.
- Headers: CSP `default-src 'self'; script-src 'self'; style-src 'self';
img-src 'self' data:; connect-src 'self'; frame-ancestors 'none';
form-action 'self'; base-uri 'none'`, `X-Frame-Options: DENY`,
  `Cache-Control: no-store`, `Referrer-Policy: no-referrer`,
  `X-Content-Type-Options: nosniff`, no CORS.

**What it shows and does.** The console sees only what the server already
sees (§4.1): names, roles, sizes, counts, timestamps — never content, file
names, record keys or namespace names.

| Page         | Shows                                                                                                                                                               | Actions                                                                                                                                                       |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Overview     | health verdict, uptime, version, URLs, TLS (mode, expiry, fingerprint), port mapping, storage (database, blobs, disk free), counts, traffic charts, recent problems | —                                                                                                                                                             |
| Accounts     | accounts with role, quota, usage, device and namespace counts, state                                                                                                | create; pair a device (QR on screen); pair the admin app (admin accounts, local only); rename, change role/quota, disable/enable; delete (typed confirmation) |
| Devices      | every device with account, platform, key state, last seen, origin, admin device                                                                                     | revoke; remove admin access                                                                                                                                   |
| Namespaces   | id, app, owner, members (names + roles), usage, seq, key epoch, pending invites                                                                                     | —                                                                                                                                                             |
| Traffic      | requests / 4xx / 5xx / rate-limited per minute (last 60 min), latency p50/p95/p99, per-route table, live SSE connections                                            | —                                                                                                                                                             |
| Logs         | live tail of the in-memory log buffer (last 2000 entries) with level filter and search                                                                              | pause; download the debug log file                                                                                                                            |
| Audit        | the audit chain, newest first, filterable by action                                                                                                                 | verify the chain                                                                                                                                              |
| Settings     | version history (days after replacement, versions per file) and trash days, each with its configured default                                                        | change; go back to the configured value                                                                                                                       |
| Troubleshoot | checks (below) with a fix hint for each failure; effective configuration                                                                                            | re-run checks; renew certificate (acme); refresh port mapping; run housekeeping; back up; diagnostics bundle                                                  |

Checks (shared with `storage-server doctor`): data directory writable and
private, database integrity, audit chain, an admin exists, disk space,
certificate present and valid, port mapping and NAT type, public URL
answers `/v1/info`, network exposure (plain HTTP or the console beyond
loopback), errors logged in the last hour. Each returns `{id, label, status:
ok|warn|fail|skip, detail, hint}`.

The **diagnostics bundle** is a JSON download of the overview, checks,
redacted configuration, traffic metrics and the last 500 log entries — what
a bug report needs, with no tokens, codes or user content.

**Monitoring.** `GET /metrics` (bearer or session) serves Prometheus text:
`storage_http_requests_total{method,route,status}`,
`storage_http_request_duration_seconds` (histogram), `storage_sse_connections`,
`storage_accounts`, `storage_devices`, `storage_devices_pending`,
`storage_namespaces`, `storage_blob_bytes`, `storage_database_bytes`,
`storage_disk_free_bytes`, `storage_cert_expiry_seconds`,
`storage_audit_chain_ok`, `storage_log_errors`, `storage_log_warnings`,
`storage_up_seconds`.

**API** (JSON, same authentication): `GET /api/overview`, `/api/metrics`,
`/api/accounts`, `POST /api/accounts`, `PATCH|DELETE /api/accounts/:id`,
`POST /api/accounts/:id/pairing` (`{console: true}`: an admin device, local
only), `POST /api/pairing` (new account), `GET /api/devices`,
`PATCH /api/devices/:id {console: false}`, `DELETE /api/devices/:id`, `GET /api/namespaces`,
`GET /api/logs?after=&level=&q=`, `GET /api/logs/stream` (SSE),
`GET|PATCH /api/settings` (`{historyDays?, historyCount?, trashDays?}`,
`null` = the configuration's value; stored in `settings`, audited
`settings.update`),
`GET /api/logs/file`, `GET /api/audit?before=&action=`,
`POST /api/audit/verify`, `GET /api/checks`, `GET /api/config`,
`POST /api/actions/{renew-certificate,refresh-port-mapping,housekeeping,backup}`,
`GET /api/diagnostics`. Every mutating call is written to the audit log with
actor `admin-console` (or the admin device's id, §11.2).

**Implementation.** `src/admin/`: `console.ts` (listener, auth, routing),
`api.ts` (endpoints), `session.ts`, `metrics.ts` (fed by the device-API
handler's `onRequest` hook), `log-buffer.ts` (a `Logger` tee),
`checks.ts` (shared with `doctor`), `ui/` (vanilla TypeScript + CSS, bundled
by esbuild at build time into the server and served as `/app.js`,
`/app.css`). Browser tests live in `packages/server/browser-tests/`.

### 11.2 Remote console and Storage Remote

The hoster administers and uses the server from a phone. The same console
API, the same pages; only the way in differs.

**Admin devices.** A device whose pairing carried `console` and whose
account is an admin. Such pairings are minted only where admin access
already exists: the local console (`POST /api/accounts/:id/pairing
{console: true}`, "Pair admin app") and the CLI (`pair --account <admin>
--console`). The device API refuses them
(`POST /v1/pairings`, and the remote console's own pairing endpoint when
`console` is asked for), so no device — an admin device included — can
create another. The flag can be dropped (`PATCH /api/devices/:id {console:
false}`, "Remove admin access", audited `device.console-revoke`) but never
set after pairing. Demoting or disabling the account ends it at once
(`authenticate` requires role `admin`).

**Remote console.** `serve` builds one console API (`createConsoleApi`) and
serves it twice: on the local listener (admin token / session) and on the
device API at `/v1/console/*rest` (`admin/remote.ts`), where the principal
must be an admin device. Handlers receive `actor` (the device id, audited
as such) and `remote`. SSE (the live log) and downloads (debug log,
diagnostics) work over the device API too. `--remote-console off`
(`remoteConsole: false`) answers 404 for every device. Test servers mount
it too (`createStorageServer({ console: {} })`).

**Storage Remote (`apps/remote`).** A dependency-free TypeScript app on the
framework's self-hosted client (app id `drive`):

- _Pair_: scan (native) or paste the console's code, or open an `#oss=`
  link; then create the account key (first device; recovery key shown
  once), recover, or wait for approval (safety code).
- _Server_: mounts `packages/server/src/admin/ui/shell.ts` unchanged, with a
  transport (`ui/api.ts` `useTransport`) that maps `/api/…` to
  `/v1/console/…` and signs in with the device key; SSE is read over
  `fetch`. `isRemote()` hides "Pair admin app".
- _Files_: shared folders are `drive` namespaces; folders inside are path
  prefixes (an empty one is kept by a hidden `.folder` marker file).
  Upload (multipart above 8 MiB via the framework), save/share, rename
  and move, delete to trash, versions, trash restore/purge, sharing by
  invite (role, TTL, one use), member removal with rotation, joining
  invites. Live updates from `/v1/events`.
- _This phone_: approve pending devices (safety codes), add a device by
  QR (key transfer), new recovery key, revoke devices, sign out.

**Native wrapper (`apps/remote/native`).** An Expo shell like time's: the
build is served from a loopback origin (port 8321) out of the download, and
a bridge script injected before load offers three capabilities the page
looks for — `__ossKeyVault` (Keychain / Android Keystore via
expo-secure-store, `WHEN_UNLOCKED_THIS_DEVICE_ONLY`), a QR scanner
(expo-camera) and the share sheet (expo-sharing; the decrypted copy is
deleted after). Bridge requests are answered only for the bundled origin.
The server must present a publicly trusted certificate (ATS; a WebView
cannot pin `fp`).

### 11.3 Headless admin CLI (`storage`)

A second CLI, separate from `storage-server`, that administers a running
server through the console API alone — every page and action of §11.1
from a terminal, a script or a container. It never opens the data
directory's database and adds no server surface.

**Transports.** The console listener with the admin token as a bearer
(`/api/…`, `/metrics`), or the device API as an admin device (§11.2):
`/v1/console/<path>` for `/api/<path>` and `/v1/console/prometheus` for
`/metrics`. An admin device is created by `storage auth login <pairing
payload>`: the CLI makes a P-256 signing key (node:crypto), redeems the
console pairing with platform `cli` (the encryption key's private half is
discarded — the CLI never holds an account key), signs challenges with
IEEE-P1363 ECDSA, and caches the 10-minute access token in
`tokens.json`. A code that enrols an ordinary device is refused and the
device revoked on the spot. Self-signed servers are pinned by the
payload's `fp` (SPKI SHA-256), checked on the connected socket before a
request byte is written. `--admin-app` pairings stay local only.

**Credentials** (first match wins): `-c/--context`; `STORAGE_SESSION`
(`storage auth export`: URL, server id, device id, key); `STORAGE_TOKEN`
(+ `STORAGE_URL`, default `http://127.0.0.1:8081`); `STORAGE_CONTEXT`; the
saved context whose URL is `STORAGE_URL`; the current context;
`admin.token` in the local default data directory. `*_FILE` variants read
secrets from files (Docker secrets). The environment is the process
environment over `.env` (or `--env-file`) files. Saved credentials are
only sent to their own context's URL. Contexts live in
`<config-dir>/config.json` (0600 in a 0700 directory; `STORAGE_CONFIG_DIR`,
default `$XDG_CONFIG_HOME/storage`).

**Surface** (`packages/cli/src/spec.ts`, rendered to `--help`, `commands`,
`--help-agent`, `--debug-agent` and `man/storage/*.md`): `auth
{login,logout,status,token,export}`, `context {ls,use,show,rename,rm}`,
`status`, `account {ls,view,create,edit,pair,rm}`, `device
{ls,view,revoke,remove-admin}`, `namespace {ls,view}`, `traffic`,
`metrics`, `logs [-f] | logs download`, `audit {ls,verify}`, `doctor`,
`system {config,housekeeping,backup,renew-cert,refresh-ports,diagnostics}`,
`api <path>`. Lists take `--json`, `-q` and `--format '{{.field}}'`;
piped tables are tab-separated without headers; destructive commands ask
(or need `--yes`). Exit codes 0 / 1 / 2 / 4 (not logged in or rejected).

**Image.** `packages/cli/Dockerfile` → `ghcr.io/niclaslindstedt/storage-cli`
(distroless, non-root, `/config` volume, `/work` working directory);
`compose.yaml`'s `cli` profile reads `admin.token` from the server's data
volume read-only.

### 11.4 AI agents (`storage-mcp`) and agent devices

**Agent devices.** A pairing may carry a scope `{perms, apps}`; the device
it enrols keeps it (`devices.scope`, migration 3) and the server enforces it
on every authenticated request (`services/scope.ts`, called by the HTTP
handler before any route):

| Permission      | Routes                                                                                                 |
| --------------- | ------------------------------------------------------------------------------------------------------ |
| `data:read`     | namespaces (list/get/members), files (list/get/head/history/revisions/trash), records, changes, events |
| `data:write`    | + create/update/delete namespaces, file and record writes, moves, copies, restores, uploads, batch     |
| `sharing`       | members (role, remove), invites, invite acceptance, key wraps, rotation                                |
| `devices`       | own devices and pending devices, pairings, `PUT /v1/me/keys` beyond the device's own first wrap        |
| `console:read`  | `GET /v1/console/*` (+ `POST audit/verify`), `GET /v1/admin/*` — admin devices only                    |
| `console:write` | the rest of `/v1/console/*` and `/v1/admin/*`                                                          |

Always allowed: `GET /v1/info`, `GET /v1/me`, logout, revoking itself.
Writes imply reads. An unclassified route is refused (a test checks the
table covers the router). `apps` limits namespaces: others are `404`,
creating or joining one is `403`, and `ns` events for them are not sent.
Scopes are minted by the console (`POST /api/accounts/:id/pairing {agent}`,
"Pair an agent"; `storage account pair --agent`, §11.3), the server CLI
(`pair --agent --perms --apps`), or the device API
for the caller's own account; a scoped caller's pairings are intersected
with its own scope (and lose console permissions); console permissions need
a console pairing. `PATCH /api/devices/:id {agent}` (`storage device
scope`) narrows (never widens)
and signs the device out; audited `device.scope`.

**`storage-mcp`** (`packages/mcp`, no runtime dependencies; the framework's
self-hosted client is bundled from source):

- _Pairing_ is a CLI step for a person (`storage-mcp pair`), never a tool:
  it redeems the code, then gets the account key by approval (safety code)
  or the recovery key (typed, not echoed). `serve` refuses an unscoped
  device unless `allowUnscoped`.
- _Transport_: stdio, newline-delimited JSON-RPC, stdout for MCP only.
  2026-07-28 (per-request `_meta`, `server/discover`, `resultType`,
  `input_required` + `requestState`) and 2024-11-05…2025-11-25
  (`initialize`, `elicitation/create` requests). Tools only; the list is
  fixed per process; inputs validated against closed schemas.
- _Tools_: parity with the console (§11.1) and Storage Remote (§11.2) —
  groups `server`, `logs`, `admin`, `files`, `records`, `sharing`,
  `devices` (+ `whoami`). A tool is offered when the scope grants its
  permission, the device is an admin device for console tools, and the
  local policy allows its group at its level and does not deny it.
- _Local policy_ (`config.json`, `serve` flags): groups `off|read|write`,
  `deny`, `allow`, `apps`, `folders`, `confirm: require|host`,
  `limits`. Flags only narrow.
- _Confirmation_: destructive, sharing and account-changing tools ask the
  person by form elicitation; the 2026-07-28 `requestState` is
  HMAC-SHA-256-sealed, bound to the tool and its canonical arguments, 10
  minutes, single use. Deleting an account or namespace needs its name
  typed. Without elicitation such tools are refused (`confirm: host`
  defers ordinary confirmations to the client's prompt).
- _Keys and credentials_ are never tools. Approving a device (the person
  types the safety code; compared with the locally computed one), adding a
  device by QR, a new recovery key and an invite are `storage-mcp device
approve|add`, `recovery-key`, `invite`: they need the device's `devices`
  or `sharing` permission and an interactive terminal (stdin and stdout
  TTYs), and print to it only. Pairing codes are `storage account pair`
  (§11.3). The agent is told where to send the person.
- _Output_: names stripped of control/bidi/zero-width characters; content
  and server JSON fenced in `<untrusted-… id>` with a random per-result
  boundary; reads capped (`maxReadBytes`), lists capped.
- _Network_: one origin (the paired server), HTTPS except loopback, no
  redirects; with a QR `fp`, TLS is accepted only for that SPKI, checked
  before the request is written.
- _At rest_: `vault.json` (AES-256-GCM) under `vault.key` or scrypt
  (`STORAGE_MCP_PASSPHRASE`, N=2¹⁷, r=8, p=1); 0600 files in a 0700
  directory, refused when looser. Keys imported non-extractable.
- _Accountability_: `<profile>/audit.log` (JSONL, content → size + hash),
  plus the server's audit chain under the device id; rate limit 60/min,
  burst 20, 4 concurrent.

### 11.5 Web drive (`apps/drive`) and file versions

**The page.** A dependency-free TypeScript app on the framework's
self-hosted client (app id `drive`, its own IndexedDB key vault
`storage-drive`), built by `make drive` and copied into the website at
`/storage/drive/` by `make website` (a static app beside the prerendered
pages: `noindex`, outside the sitemap and the SEO checks). It can be served
from anywhere else too. `<meta>` CSP: `default-src 'self'; script-src
'self'; style-src 'self'; img-src 'self' data: blob:; connect-src https:
http:; object-src 'none'; base-uri 'none'; form-action 'none'`.

- _Sign in_: a pairing payload (pasted, or an `#oss=` link) — a
  server-created code (then create keys, recover, or approval), or a
  device-created one (key transfer). The server learns the page's origin
  at pairing (CORS `paired`). A plain-HTTP server is refused up front from
  an HTTPS page (mixed content), except loopback.
- _Files_: Storage Remote's file pages (`apps/remote/src/files`, aliased
  `@storage/remote/*`) in a desktop layout: a sidebar of shared folders,
  Activity, This browser. Shared with Remote and so on the phone too:
  drag-and-drop upload; a taken name is **replaced** (a new version,
  compare-and-swap on the current rev) or kept as `name (2)`; a preview for
  text and raster images (never HTML or SVG); the versions dialog.
- _Versions_: list, download, restore; for text, **Changes** (a version
  against the one before) and **Compare** (any two), a Myers line diff with
  three lines of context in hunks, computed on the device after decrypting
  both (UTF-8 only, ≤ 2 MiB, ≤ 2000 edits then "rewritten"); copy as
  `diff -u`. Retention is read from `/v1/info`.
- _Sync_: `SyncMonitor` subscribes to `/v1/events`; on `ns` it pulls the
  namespace's change feed from its cursor (one pull per namespace at a
  time), decrypts it into activity (added / changed / deleted / folder),
  and a 30 s heartbeat compares every folder's `seq` (missed events,
  reconnects, `online`/`offline`). States: connecting, live, syncing,
  offline; an `AuthError` means the device was revoked.

**Retention as a setting.** `services/settings.ts`: `retention(ctx)` =
`config.retention` overlaid by the `retention` row in `settings` (JSON);
`pruneHistory` and housekeeping read it on every call, so a change applies
at once. Bounds: `historyDays` 0–3650, `historyCount` 1–10000, `trashDays`
1–3650; flags `--history-days`, `--history-versions`, `--trash-days`
(`STORAGE_*`) set the configuration's defaults. Surfaces: console
Settings, `storage settings {show,set,reset}`, MCP `server_settings` /
`update_settings`.

## 12. Testkit (`@niclaslindstedt/storage-testkit`)

```ts
const server = await startTestServer(); // in-process, memory DB, random port, test mode
const alice = await server.createAccount("alice"); // → { accountId, pairingPayload }
await server.faults.add({
  match: { path: "/v1/ns/" },
  action: "status",
  status: 503,
  times: 2,
});
await server.faults.offline();
await server.faults.clear();
await server.clock.advance(15 * 60_000);
const snap = await server.snapshot();
await server.restore(snap);
await server.reset();
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

- [x] S1 workspace scaffolding (tsconfig, vitest, eslint, prettier, Makefile)
- [x] S2 clock, ids, random, config, logging (§19)
- [x] S3 database schema + migrations (`node:sqlite`), blob store (fs + memory)
- [x] S4 HTTP core: router, validation, errors, CORS, security headers, rate limits, body limits
- [x] S5 auth: challenge/token, device signature verify, token store
- [x] S6 accounts, devices, pairing (server- and device-created), keys, pending devices
- [x] S7 namespaces, members, invites, key wraps, rotation, epoch enforcement
- [x] S8 files: CAS put/get/head/delete, list (prefix/recursive/cursor), move/copy, history, trash, uploads, quotas
- [x] S9 records: get/put/delete/list, batch (atomic / per-op), tombstones
- [x] S10 change feed (+ long-poll), SSE events hub
- [x] S11 audit log hash chain + verify
- [x] S12 retention / GC jobs (history, trash, tombstones, blobs, expired pairings/invites/tokens)
- [x] S13 admin API
- [x] S14 test mode (reset, snapshot/restore, faults, clock, accounts)
- [x] S15 QR encoder + terminal/SVG renderers
- [x] S16 ASN.1 DER, CSR, self-signed certs; TLS manager (files/self-signed/off)
- [x] S17 ACME client (http-01, tls-alpn-01, dns/ip identifiers) + fake CA tests
- [x] S18 UPnP IGD + NAT-PMP + CGNAT detection
- [x] S19 CLI (all commands + §12 discoverability) and loopback admin page
- [x] S20 Dockerfile, compose.yaml, healthcheck (image build verified in CI; Docker Hub rate-limits the dev sandbox)

### Framework (`oss-framework`)

- [x] F1 `src/qr` encoder + SVG + `<QrCode>`
- [x] F2 selfhosted crypto (envelopes, names, wraps, recovery key)
- [x] F3 KeyVault (memory, IndexedDB non-extractable, native host, PIN protect)
- [x] F4 transport (auth, retries, error mapping, SSE parser)
- [x] F5 client: pairing, account keys, recovery, device approval, device pairing
- [x] F6 namespaces, sharing (invites, members, rotation + re-encryption)
- [x] F7 FileStore + StorageAdapter (CAS, watch, probe, getRevision)
- [x] F8 merge (3-way), RecordStore, row-document adapter
- [x] F9 README, subpath exports, size budgets, changeset fragment, lint/test/build/size green

### Testkit & e2e

- [x] T1 `startTestServer` (in-process) + `startTestServerProcess` (subprocess) + helpers
- [x] T2 e2e: pairing / recovery / approval
- [x] T3 e2e: files CAS, history, trash, uploads, quotas
- [x] T4 e2e: records + row documents + concurrent devices
- [x] T5 e2e: sharing, revocation, rotation
- [x] T6 e2e: faults/offline, change feed, SSE watch
- [x] T7 e2e: app-shaped scenarios (meds, contacts, notes, calendar)

### Reference app (`apps/reference`)

- [x] A1 Vite + React app on `oss-framework/storage/selfhosted`: pair (QR/paste), recovery key, namespaces, files, rows, sharing, conflicts, sync status
- [x] A2 testability: `data-testid` everywhere, deterministic ids/clock hooks, `?server=` param, in-page event log
- [x] A3 Playwright suite against `storage-server test-server` (two browser contexts = two devices / two people)

### Repository (OSS_SPEC)

- [x] R1 root files (LICENSE, README, CONTRIBUTING, COC, SECURITY, AGENTS + symlinks, CHANGELOG, .gitignore, .editorconfig, Makefile)
- [x] R2 .github (workflows ci/version-bump/release/pages/seo/lighthouse, templates, dependabot, CODEOWNERS)
- [x] R3 docs/, man/, examples/, prompts/, scripts/, .agents/skills/
- [x] R4 website/ (SEO scaffolding)
- [x] R5 `scripts/validate.sh` from oss-spec reports no structural violations

### Admin console (§11.1)

- [x] C1 SPEC §11.1 design
- [x] C2 `metrics.ts` + handler `onRequest` hook + Prometheus text
- [x] C3 `log-buffer.ts` (Logger tee, ring buffer, subscribers)
- [x] C4 `checks.ts` shared with `doctor`
- [x] C5 admin token file, sessions, host/CSRF guards, `storage-server admin [--rotate]`
- [x] C6 console API (overview, accounts, devices, pairing, namespaces, logs, audit, checks, actions, config, diagnostics, metrics)
- [x] C7 UI (overview, accounts, devices, namespaces, traffic, logs, audit, troubleshoot) bundled into the server
- [x] C8 tests: unit (server), full-stack e2e (revoke from the console), Playwright (UI)
- [x] C9 docs (`docs/admin-console.md`, configuration, security, README, website), Docker (`STORAGE_ADMIN_HOST`), man pages

### Remote console and Storage Remote (§11.2)

- [x] M1 SPEC §11.2 design, D13
- [x] M2 admin devices: migration 2 (`devices.console`, `pairings.console`), console pairings from the local console / CLI only, `authenticate` gating, drop access
- [x] M3 `/v1/console/*` over the shared console API (`createConsoleApi`, `admin/remote.ts`), `--remote-console`, `console` capability, audited by device
- [x] M4 console UI: pluggable transport, mountable shell, "Pair admin app", admin-device badges
- [x] M5 `apps/remote`: pairing, keys, Server tab, Files (drive, uploads, versions, trash, sharing), This phone
- [x] M6 `apps/remote/native`: loopback server, Keychain key vault, QR scanner, share sheet, bundle script, icons
- [x] M7 tests: server unit (`admin_remote_test.ts`), console browser test, e2e (`remote_test.ts`), app unit + Playwright, native bridge pinning; CI job `remote-native`
- [x] M8 docs (`docs/remote-app.md`, admin console, protocol, security, configuration, testing, README), man pages
- [ ] M9 store listings (App Store / Play) and EAS project for the wrapper

### Headless admin CLI (§11.3)

- [x] H1 SPEC §11.3 design, D14
- [x] H2 `packages/cli`: registry, parser, `.env` / environment credentials, contexts, token and admin-device transports (pinning, token cache, 429 retry)
- [x] H3 commands with console parity: auth, context, status, account, device, namespace, traffic, metrics, logs (follow, download), audit, doctor, system, api
- [x] H4 `/v1/console/metrics` answers the Traffic JSON (`/v1/console/prometheus` for Prometheus text) — also fixes Storage Remote's Traffic page
- [x] H5 tests: units, both transports end to end against a real server, man pages; CI docker smoke (`scripts/docker-smoke-cli.sh`)
- [x] H6 `storage-cli` image, compose `cli` service, release (npm + GHCR), `docs/cli.md`, `man/storage/`, README

### AI agents (§11.4)

- [x] G1 SPEC §11.4 design, D15; research: MCP 2026-07-28 / 2025-11-25, MCP security best practices, OWASP MCP guidance
- [x] G2 agent scopes: migration 3 (`devices.scope`, `pairings.scope`), `services/scope.ts` route table (fail closed), app limits, key-handover limits, pairing inheritance, narrowing (`PATCH /api/devices/:id {agent}`), `/v1/me` `agent`, `agents` capability
- [x] G3 `storage-server pair --agent --perms --apps`, `storage account pair --agent` and `storage device scope` (headless CLI), console "Pair an agent" + agent badges
- [x] G4 `packages/mcp`: dual-era stdio MCP server, schema validation, MRTR elicitation with sealed `requestState`, rate limits, cancellation
- [x] G5 `storage-mcp` vault, network confinement + pinning, config/policy, audit log, CLI (`pair`, `serve`, `status`, `tools`, `config`, `unpair`)
- [x] G9 keys and credentials move out of the agent's reach: no pairing, approval, invite or recovery-key tools; person-only `storage-mcp device approve|add`, `recovery-key`, `invite` (interactive terminal); `storage account pair --agent` / `storage device scope` in the headless CLI
- [x] G6 tools with console + Remote parity (server, logs, admin, files, records, sharing, devices)
- [x] G7 tests: server `agent_scope_test.ts`, MCP protocol / units / integration / parity / stdio, console browser test
- [x] G8 docs (`docs/mcp.md`, security, protocol, admin console, architecture, README), release publishes `@niclaslindstedt/storage-mcp`

### Web drive and file versions (§11.5)

- [x] W1 SPEC §11.5 design, D16
- [x] W2 retention as a runtime setting: `services/settings.ts`, a version's age counts from its replacement, `/v1/info` `retention`, flags `--history-days` / `--history-versions` / `--trash-days`, default 100 versions
- [x] W3 console Settings page + `GET|PATCH /api/settings`, `storage settings`, MCP `server_settings` / `update_settings`
- [x] W4 shared file pages: versions dialog with on-device text diff (`files/diff.ts`), replace-or-keep-both uploads, drag and drop, preview
- [x] W5 `apps/drive`: sign-in, keys, sidebar, Activity and sync status (`SyncMonitor`), This browser; built into the website at `/storage/drive/`
- [x] W6 tests: server (retention, settings, console API, CLI flags), CLI both transports, MCP parity, diff and sync units, Playwright (drive, Remote, console)
- [x] W7 docs (`docs/drive.md`, admin console, configuration, protocol, security, CLI, MCP, remote app, README, website)
