# Protocol (HTTP API v1)

All endpoints are under `/v1`. JSON bodies, except file contents
(`application/octet-stream`). Errors: `{"error": {"code", "message", ...}}`.
Revisions are opaque decimal strings, sent as `ETag: "<rev>"`; conditional
writes use `If-Match: "<rev>"` or `If-None-Match: *`. Authenticated calls
carry `Authorization: Bearer <token>`.

| Status    | `code`            | Meaning                                                 |
| --------- | ----------------- | ------------------------------------------------------- |
| 400       | `invalid_request` | Malformed input (details in `message`)                  |
| 401       | `unauthenticated` | Missing/expired token, or bad pairing code              |
| 403       | `forbidden`       | Role too low                                            |
| 404       | `not_found`       | Also returned for namespaces you are not a member of    |
| 409 / 412 | `conflict`        | Revision mismatch; `current` holds the server's version |
| 410       | `cursor_expired`  | Change-feed cursor too old (or ahead): resync           |
| 413       | `too_large`       | Body or item over a limit                               |
| 429       | `rate_limited`    | See `Retry-After`                                       |
| 507       | `quota_exceeded`  | Owner's quota would be exceeded                         |

## Identity

- `GET /v1/info` — server id, name, protocol, capabilities, TLS mode/fingerprint. `capabilities` includes `console` when admin devices can use the remote console.
- `POST /v1/pair {code, device}` — enrol a device (`device = {name, platform, dskPublic, dekPublic}`; keys are raw uncompressed P-256 points, base64url). The answer's `console` is `true` when the code enrolled an admin device.
- `POST /v1/auth/challenge {deviceId}` → `{challenge}`; `POST /v1/auth/token {deviceId, challenge, signature}` → `{token, expiresAt}`. The signature is ECDSA P-256/SHA-256 (IEEE P1363) over `oss-storage/v1/auth|<serverId>|<deviceId>|<challenge>`.
- `POST /v1/pairings` — mint a pairing (own account; admins: any/new). `console: true` is always refused here: admin devices are paired only from the local console or the CLI.
- `GET /v1/me` (with `console`: whether this is an admin device), `PUT /v1/me/keys`, `GET /v1/me/devices`, `GET /v1/me/pending-devices`, `PATCH|DELETE /v1/devices/:id`.
- `GET /v1/events` — Server-Sent Events: `ns {ns, seq}`, `namespaces`, `device {revoked}`.

## Admin

- `GET|POST /v1/admin/accounts`, `PATCH|DELETE /v1/admin/accounts/:id`, `GET /v1/admin/audit`, `GET /v1/admin/stats` — any device of an admin account.
- `GET|POST|PATCH|DELETE /v1/console/<path>` — the admin console's own API (`/api/<path>` on the console, and `/v1/console/prometheus` for its Prometheus `/metrics`), for **admin devices** only: a device paired with a console pairing, whose account is an admin. Same requests and answers as on the console; changes are audited under the device's id. `404` when the server runs with `--remote-console off`. See [Storage Remote](remote-app.md).

## Namespaces and sharing

- `GET /v1/namespaces?app=`, `POST /v1/namespaces {id?, app, meta, wrap}` (the client may choose `id` — it salts the key derivation), `GET|PATCH|DELETE /v1/namespaces/:ns`.
- `GET /v1/namespaces/:ns/members`, `PATCH|DELETE …/members/:account`.
- `GET|POST /v1/namespaces/:ns/invites`, `DELETE …/invites/:id`, `POST /v1/invites/accept {code[, device, accountName]}`.
- `POST /v1/namespaces/:ns/keys {epoch, wraps}`, `POST /v1/namespaces/:ns/rotate {epoch, wraps}`.

## Files

- `GET /v1/ns/:ns/files?prefix=&recursive=1&cursor=&limit=`
- `GET|HEAD|PUT|DELETE /v1/ns/:ns/files/<path>` — `X-Meta` carries the sealed metadata, `X-File-Id` the stable file id.
- `POST /v1/ns/:ns/files:move {from, to, meta, ifMatch?, overwrite?}`, `files:copy {from, to, meta}`.
- `GET /v1/ns/:ns/history/<path>`, `GET /v1/ns/:ns/revisions/:fileId/:rev`, `POST /v1/ns/:ns/history:restore {path, rev, meta}`.
- `GET /v1/ns/:ns/trash`, `POST /v1/ns/:ns/trash:restore {fileId[, path, meta]}`, `DELETE /v1/ns/:ns/trash/:fileId`.
- `POST /v1/ns/:ns/uploads` → `{uploadId}`; `PUT …/uploads/:id/parts/:n`; `POST …/uploads/:id/commit {path, meta, ifMatch?}`; `DELETE …/uploads/:id`.

## Records

- `GET /v1/ns/:ns/collections` — every (encrypted) collection name with its live row count.
- `GET /v1/ns/:ns/records/:collection?cursor=&limit=&includeDeleted=1`
- `GET|PUT|DELETE /v1/ns/:ns/records/:collection/:key` — `PUT {value}` with `If-Match` / `If-None-Match: *`.
- `POST /v1/ns/:ns/batch {atomic, ops}` — ops `put`, `delete`, `check`, `file.put` (≤ 1 MiB inline), `file.delete`.

## Change feed

`GET /v1/ns/:ns/changes?since=<seq>&limit=&wait=<seconds ≤ 30>` →
`{seq, changes, more}`. Items: `file`, `record` (values inline), `namespace`
(meta/epoch), `members`. A batch is never split across pages.

## Ciphertext format

`OSE1` envelope: `"OSE1" | 0x01 | epoch u32 BE | 12-byte IV | AES-256-GCM
ciphertext+tag`. The server reads only the header, to enforce the current
key epoch.
