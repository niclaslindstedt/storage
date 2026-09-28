# Architecture

```
app ─► oss-framework/storage/selfhosted ─► HTTPS /v1 ─► storage-server ─► SQLite + blobs
        (encrypts, merges, holds keys)                   (stores ciphertext, orders writes)
```

## Division of labour

The **client** (the framework module) does everything that needs plaintext:
encryption and decryption, deterministic name encryption, key wrapping,
three-way merges, and the `FileStore` / `StorageAdapter` / `RecordStore`
bindings apps use.

The **server** does everything that needs a single point of order without
plaintext: authentication, authorisation, atomic compare-and-swap, the
change sequence, history, trash, retention, quotas, sharing membership and
the audit log.

## Source layout (`packages/server/src`)

| Path                       | Responsibility                                                        |
| -------------------------- | --------------------------------------------------------------------- |
| `db/`                      | SQLite wrapper (savepoint transactions) and forward-only migrations   |
| `blobs.ts`, `blob-refs.ts` | Content-addressed byte store and reference counting                   |
| `services/`                | Domain logic, one module per concern — no HTTP in here                |
| `http/`                    | Router, request lifecycle, CORS, rate limits                          |
| `api/`                     | Route modules mapping HTTP to services                                |
| `tls/`                     | DER/X.509 builder, ACME client, certificate manager                   |
| `net/`                     | UPnP IGD, NAT-PMP, port mapper, NAT diagnostics                       |
| `qr/`                      | QR encoder and renderers                                              |
| `admin/`                   | Admin console: listener, auth, API, metrics, log buffer, checks, UI   |
| `cli/`                     | Command registry (single source of truth) and commands                |
| `app.ts`                   | Embeddable server (routes + handler) — what tests and the testkit run |
| `serve.ts`                 | Production runtime (HTTPS, ACME, redirects, UPnP, jobs)               |

## Headless admin CLI (`packages/cli`)

`storage` is a client of the admin console's API and nothing else: the
console listener with the admin token, or `/v1/console` on the device API
as an admin device with its own signing key. `src/spec.ts` is its command
registry; `client.ts` resolves credentials (flags, environment, `.env`,
saved contexts, the local `admin.token`) and picks the transport;
`http.ts` pins self-signed servers; `commands/` maps console pages to
commands. See [Headless admin CLI](cli.md).

## Other packages

| Package            | What it is                                                                                                                                                                                      |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/testkit` | A real server for tests, in process or as a subprocess, with faults, clock and snapshots                                                                                                        |
| `packages/mcp`     | `storage-mcp`, the MCP server for AI agents: a client like any app (the framework's client bundled from source), paired as an agent device the server holds to a scope. See [AI agents](mcp.md) |
| `apps/remote`      | Storage Remote, the hoster's app: the console's pages over `/v1/console` plus an encrypted drive                                                                                                |

## Data model

Namespaces own files (one row per encrypted path, plus revisions and a
trash) and records (rows in encrypted collections). Every mutation bumps the
namespace's `seq` and stamps the item with it; an item's revision _is_ that
stamp, which makes the change feed a range query. Deleted items stay as
tombstones until retention purges them and advances `purged_seq`.

Bytes live in the blob store under the SHA-256 of their (encrypted)
contents, reference-counted in the database. Writes put bytes first, pin
them, then commit the referencing transaction synchronously, so a crash or
a failed condition can only ever leave an unreferenced blob, which the
startup sweep removes.

## Why synchronous SQLite

One process owns the database. A synchronous transaction cannot interleave
with another request, which makes compare-and-swap trivially correct; WAL
mode lets the CLI read and administer the same database while the server
runs.
