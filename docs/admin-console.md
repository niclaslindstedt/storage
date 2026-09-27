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

| Page         | What it is for                                                                                                                                                                 |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Overview     | A health verdict with the failing checks, uptime, traffic charts, counts, storage and disk, TLS certificate, port mapping, recent warnings and recent administration.          |
| Accounts     | Create accounts, show a **pairing QR code** for a new device, rename, change role or quota, disable/enable, delete (you type the name to confirm).                             |
| Devices      | Every device with its account, platform, state (active, pending keys, revoked), app origin and last activity. **Revoke** signs a lost device out for good.                     |
| Namespaces   | Each app bucket's owner, members and roles, pending invites, size, change count and key epoch. Names and contents are end-to-end encrypted and are not shown.                  |
| Traffic      | Requests, client and server errors and rate-limited requests per minute for the last hour, latency percentiles, open live connections, and a per-endpoint table.               |
| Logs         | A live tail of the server log with a level filter, search and pause, plus a download of the full debug log file.                                                               |
| Audit log    | The tamper-evident audit chain, newest first, filterable by action, with a **Verify chain** button.                                                                            |
| Troubleshoot | Every health check with a fix for each problem; renew the certificate, refresh port mapping, run housekeeping, back up, download a diagnostics bundle; the effective settings. |

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

Everything the UI does goes through a JSON API on the same port. Scripts
authenticate with `Authorization: Bearer <admin token>`:

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
| `GET /api/devices`, `DELETE /api/devices/:id`                                       | List, revoke                                                                                     |
| `GET /api/namespaces`                                                               | Namespace metadata                                                                               |
| `GET /api/logs?after=&level=&q=&limit=`                                             | Log entries; `/api/logs/stream` is the live SSE stream; `/api/logs/file` downloads the debug log |
| `GET /api/audit?before=&action=&limit=`, `POST /api/audit/verify`                   | Audit entries, newest first; verify the chain                                                    |
| `GET /api/checks`, `GET /api/config`                                                | Run the checks; the effective configuration                                                      |
| `POST /api/actions/{renew-certificate, refresh-port-mapping, housekeeping, backup}` | Maintenance actions                                                                              |
| `GET /api/diagnostics`                                                              | A JSON bundle for bug reports                                                                    |

Every change made through the console is recorded in the audit log with the
actor `admin-console`.

## Security

- The console is a separate listener. It shares no port, cookie or code path
  with the device API that apps use.
- It only accepts a `Host` header that is an IP address or `localhost`. This
  defeats DNS-rebinding attacks from web pages you visit.
- Writes made with the session cookie need a custom header and a same-origin
  `Origin`, so other sites cannot forge requests (CSRF). There is no CORS.
- A strict Content-Security-Policy allows only the console's own script and
  stylesheet. The page cannot be framed.
- The console never shows content, file names, record keys or namespace names.
  The server does not have them.
