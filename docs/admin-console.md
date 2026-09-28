# Admin console

`storage-server serve` also starts a local web console for administering,
monitoring and troubleshooting the server. It shows what the server itself
can see — accounts, devices, sizes, traffic, logs and health — and never
anything the apps encrypt.

## Open it

On the machine that runs the server:

```sh
storage-server admin
```

This prints a sign-in link such as
`http://127.0.0.1:8081/login?token=…`. Open it in a browser. The link
exchanges the token for a session cookie and redirects, so the token does
not stay in the address bar or the history. When `serve` runs in an
interactive terminal it prints the link too. It never writes the link to
the log file, and it leaves it out of non-interactive output such as a
systemd journal or `docker logs`.

The console listens on **127.0.0.1:8081** by default, so only the machine
itself can reach it.

- **Another computer**: use an SSH tunnel rather than opening the port:

  ```sh
  ssh -L 8081:127.0.0.1:8081 you@homeserver
  ```

  then open the link from `storage-server admin` on your own computer.

- **Docker with host networking** (`--network host`, needed for UPnP): the
  console is on the host's `127.0.0.1:8081` as is.
- **Docker with published ports**: inside a container, 127.0.0.1 is the
  container itself. Let the console listen on all of the container's
  interfaces and publish it on the host's loopback only:

  ```sh
  docker run -d --name storage -p 8443:8443 -p 127.0.0.1:8081:8081 \
    -e STORAGE_ADMIN_HOST=0.0.0.0 \
    -v storage-data:/data ghcr.io/niclaslindstedt/storage-server
  ```

  Never publish it as `-p 8081:8081`: that puts it on the network.

- **Get the link in a container**:
  `docker exec storage /nodejs/bin/node /app/dist/cli.js admin`.

- **Turn it off**: `--admin-port -1`.

## Signing in

The console is unlocked by a 256-bit **admin token** stored in
`admin.token` in the data directory (mode 0600). Anyone who can read the
data directory can already administer the server with the CLI, so the file
adds no new trust. The token survives restarts, so bookmarks and
Prometheus scrape configurations keep working.

- A session lasts up to 12 hours and ends after one hour without activity.
- **Sign out** ends the session.
- `storage-server admin --rotate` replaces the token and ends every
  session at once, without a restart. Do this if a sign-in link leaked.
- Failed sign-ins are rate limited and recorded in the audit log.

## Pages

| Page         | What it is for                                                                                                                                                                                            |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Overview     | A health verdict with the failing checks, uptime, traffic charts, counts, storage and disk, TLS certificate, port mapping, recent warnings and recent administration.                                     |
| Accounts     | Create accounts, show a **pairing QR code** for a new device, **pair an agent** (AI agents), **pair the admin app** on your phone, rename, change role or quota, disable/enable, delete (type the name).  |
| Devices      | Every device with its account, platform, state (active, pending keys, revoked), app origin and last activity. **Revoke** signs a lost device out; admin devices and agents (with their scope) are marked. |
| Namespaces   | Each app bucket's owner, members and roles, pending invites, size, change count and key epoch. Names and contents are end-to-end encrypted and are not shown.                                             |
| Traffic      | Requests, client and server errors and rate-limited requests per minute for the last hour, latency percentiles, open live connections, and a per-endpoint table.                                          |
| Logs         | A live tail of the server log with a level filter, search and pause, plus a download of the full debug log file.                                                                                          |
| Audit log    | The tamper-evident audit chain, newest first, filterable by action, with a **Verify chain** button.                                                                                                       |
| Settings     | How long earlier versions of files and deleted files are kept (below).                                                                                                                                    |
| Troubleshoot | Every health check with a fix for each problem; renew the certificate, refresh port mapping, run housekeeping, back up, download a diagnostics bundle; the effective settings.                            |

## Settings

When a file is overwritten, the server keeps the version it replaced, so
people can compare versions and restore one from Storage Remote or the
[web drive](drive.md). **Settings** decides for how long:

| Setting                   | Default | Means                                                                             |
| ------------------------- | ------- | --------------------------------------------------------------------------------- |
| Keep earlier versions for | 30 days | Counted from the moment a version was replaced. 0 keeps no earlier versions.      |
| At most                   | 100     | Versions per file; the oldest go first. A limit for files that change very often. |
| Keep deleted files for    | 30 days | How long deleted files wait in their folder's trash.                              |

A change applies at once and wins over the server's configuration
(`--history-days`, `--history-versions`, `--trash-days`, or `retention` in
`config.json`, see [Configuration](configuration.md#version-history)).
The page shows each setting's configured value, and **Use that** goes back
to it. Shortening a period removes older versions and trashed files for
good, at the next housekeeping run (hourly, or **Run housekeeping** on
Troubleshoot) or when the file is next written. Earlier versions count
against the folder owner's quota. Every change is written to the audit log
(`settings.update`).

The versions stay end-to-end encrypted. The server keeps the older
ciphertext and cannot read or compare it; people's devices do that.

From a terminal: `storage settings` ([CLI](cli.md)). For AI agents:
`server_settings` / `update_settings` ([MCP](mcp.md)).

## Health checks

The Troubleshoot page and `storage-server doctor` run the same checks:

| Check              | Fails or warns when                                                         |
| ------------------ | --------------------------------------------------------------------------- |
| Data directory     | it is missing, or other users can read it (`chmod 700`)                     |
| Database integrity | SQLite `quick_check` reports damage                                         |
| Audit log          | the hash chain is broken (an entry was edited or deleted)                   |
| Admin account      | no enabled admin exists                                                     |
| Free disk space    | under 2 GiB or 5% (warning), under 256 MiB (failure)                        |
| TLS certificate    | missing, expiring within 7 days, or expired                                 |
| Port mapping       | the router refused, or its WAN address is carrier-grade NAT or private      |
| Public URL         | `/v1/info` does not answer at `--public-url`                                |
| Network exposure   | plain HTTP on a public interface, or the console reachable from the network |
| Recent errors      | the server logged an error in the last hour                                 |

The Overview re-runs the checks every five minutes; **Run checks again**
runs them now.

## Monitoring with Prometheus

`GET /metrics` on the console serves Prometheus text. Authenticate with the
admin token as a bearer token:

```yaml
scrape_configs:
  - job_name: storage
    authorization:
      credentials_file: /etc/prometheus/storage-admin.token
    static_configs:
      - targets: ["127.0.0.1:8081"]
```

It includes `storage_http_requests_total{method,route,status}`,
`storage_http_request_duration_seconds` (histogram),
`storage_sse_connections`, `storage_accounts`, `storage_devices`,
`storage_devices_pending`, `storage_namespaces`, `storage_blob_bytes`,
`storage_database_bytes`, `storage_disk_free_bytes`,
`storage_cert_expiry_seconds`, `storage_audit_chain_ok`,
`storage_log_errors`, `storage_log_warnings` and `storage_up_seconds`.
Routes are patterns such as `/v1/ns/:ns/records/:collection`; no id, path
or payload is recorded.

## Scripting

Everything the UI does goes through a JSON API on the same port. The
[headless CLI](cli.md) `storage` wraps all of it (`storage status`,
`storage account ls --json`, `storage logs -f`, …). Scripts can also call
it directly with `Authorization: Bearer <admin token>`:

```sh
TOKEN=$(cat ~/.local/share/storage-server/admin.token)
curl -s -H "Authorization: Bearer $TOKEN" http://127.0.0.1:8081/api/overview
curl -s -H "Authorization: Bearer $TOKEN" http://127.0.0.1:8081/api/checks
```

| Endpoint                                                                            | Does                                                                                             |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `GET /api/overview`                                                                 | Everything on the Overview page                                                                  |
| `GET /api/metrics`                                                                  | Per-minute series, per-endpoint stats, latency                                                   |
| `GET /api/accounts`, `POST /api/accounts`                                           | List (with device and namespace counts), create                                                  |
| `PATCH /api/accounts/:id`                                                           | `name`, `role`, `quotaBytes` (null = unlimited), `disabled`                                      |
| `DELETE /api/accounts/:id`                                                          | Body `{"confirm": "<account name>"}`                                                             |
| `POST /api/accounts/:id/pairing`, `POST /api/pairing`                               | A pairing QR (`svg`) and `payload`; the second creates the account on redemption                 |
| `POST /api/accounts/:id/pairing {"console": true}`                                  | An **admin device** pairing for an admin account (this console only, never remotely)             |
| `POST /api/accounts/:id/pairing {"agent": {"perms": [...], "apps": [...]}}`         | An **agent device** pairing, held to that scope by the server ([AI agents](mcp.md))              |
| `GET /api/devices`, `DELETE /api/devices/:id`                                       | List (with `console` for admin devices and `agent` for agents' scopes), revoke                   |
| `PATCH /api/devices/:id {"console": false}`                                         | Take an admin device's console access away; it stays paired                                      |
| `PATCH /api/devices/:id {"agent": {"perms": [...], "apps": [...]}}`                 | Narrow a device's scope (or make it an agent); never widens                                      |
| `GET /api/namespaces`                                                               | Namespace metadata                                                                               |
| `GET /api/logs?after=&level=&q=&limit=`                                             | Log entries; `/api/logs/stream` is the live SSE stream; `/api/logs/file` downloads the debug log |
| `GET /api/audit?before=&action=&limit=`, `POST /api/audit/verify`                   | Audit entries, newest first; verify the chain                                                    |
| `GET /api/checks`, `GET /api/config`                                                | Run the checks; the effective configuration                                                      |
| `POST /api/actions/{renew-certificate, refresh-port-mapping, housekeeping, backup}` | Maintenance actions                                                                              |
| `GET /api/diagnostics`                                                              | A JSON bundle for bug reports                                                                    |

Every change made through the console is recorded in the audit log with the
actor `admin-console`, or with the admin device's id when it came from the
remote app or an admin-device CLI.

## From your phone

The same console, with every page and action, is available on your phone
through **Storage Remote**, an app paired as an _admin device_:

1. On **Accounts**, press **Pair admin app** on your own (admin) account, or
   run `storage-server pair --account <you> --console`.
2. Scan the code with Storage Remote.

The phone then reaches this console's API through the device API
(`/v1/console`), signed in with its own device key instead of the admin
token. Only this console and the CLI can pair an admin device: an admin
device can add people and pair their ordinary devices, but never another
admin device. On **Devices**, **Remove admin access** turns an admin device
back into an ordinary one, and **Revoke** signs it out. `--remote-console off`
switches the remote console off entirely. See [Storage Remote](remote-app.md).
The headless CLI can be paired the same way (`storage auth login <payload>`,
see [Headless admin CLI](cli.md)).

## Agents

**Pair an agent** on an account pairs an _agent device_ — for an AI agent
running [`storage-mcp`](mcp.md), or a script — held by the server to the
permissions and apps you tick. Console permissions are offered for admin
accounts, here only (they make the agent an admin device). On **Devices**
an agent shows an _agent_ badge with its scope. Narrow a scope with
`PATCH /api/devices/:id {"agent": {"perms": [...], "apps": [...]}}` (it can
only shrink); **Revoke** ends it. The CLI equivalent is
`storage-server pair --account <name> --agent --perms <list> --apps <list>`
on the server's machine, or `storage account pair <name> --agent …` and
`storage device scope <id> --perms …` with the [headless CLI](cli.md).

## Security

- The console is a separate listener. It shares no port or cookie with the
  device API that apps use. Admin devices reach the same API handlers
  through the device API instead, authenticated by their device key (see
  above), never with the admin token.
- It only accepts a `Host` header that is an IP address or `localhost`. This
  defeats DNS-rebinding attacks from web pages you visit.
- Writes made with the session cookie need a custom header and a same-origin
  `Origin`, so other sites cannot forge requests (CSRF). There is no CORS.
- A strict Content-Security-Policy allows only the console's own script and
  stylesheet. The page cannot be framed.
- The console never shows content, file names, record keys or namespace names.
  The server does not have them.
