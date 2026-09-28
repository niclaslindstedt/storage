# storage

Administer a storage server headlessly — the admin console's every page and action, from a terminal, a script or a container.
Generated from `packages/cli/src/spec.ts` (`make man`); see [docs/cli.md](../../docs/cli.md) for the guide.

## Commands

| Command | Summary |
|---|---|
| [`storage auth`](auth.md) | Log in to a storage server, show and export credentials. |
| [`storage context`](context.md) | List, switch, rename and remove saved servers. |
| [`storage status`](status.md) | Health, uptime, URLs, TLS, port mapping, storage, counts and traffic at a glance. |
| [`storage account`](account.md) | List, create, edit, pair and delete accounts. |
| [`storage device`](device.md) | List devices, revoke them and remove admin access. |
| [`storage namespace`](namespace.md) | List namespaces (metadata only — contents are end-to-end encrypted). |
| [`storage traffic`](traffic.md) | Requests, errors and latency per minute and per route. |
| [`storage metrics`](metrics.md) | Print the Prometheus metrics. |
| [`storage logs`](logs.md) | Show or follow the server log; download the debug log file. |
| [`storage audit`](audit.md) | Read and verify the tamper-evident audit log. |
| [`storage doctor`](doctor.md) | Run the server's health checks and print a fix for each problem. |
| [`storage system`](system.md) | Configuration, housekeeping, backups, certificate renewal, port mapping and diagnostics. |
| [`storage settings`](settings.md) | How long earlier file versions and deleted files are kept. |
| [`storage api`](api.md) | Make an authenticated request to the console API. |
| [`storage commands`](commands.md) | List commands in a stable, grep-friendly format. |
| [`storage help`](help.md) | Show help for a command. |
| [`storage version`](version.md) | Print the version. |

## Environment

The environment is read from the process and from `.env` files (`--env-file`, or `./.env` when present); the process environment wins.

| Variable | Description |
|---|---|
| `STORAGE_URL` | Server to talk to: the console listener (with STORAGE_TOKEN, default http://127.0.0.1:8081) or the server's API URL (with STORAGE_SESSION). Alone, it picks the saved context with that URL. |
| `STORAGE_TOKEN` | The admin console token (admin.token in the server's data directory). |
| `STORAGE_TOKEN_FILE` | Read STORAGE_TOKEN from this file (Docker secrets, or the server's admin.token). |
| `STORAGE_SESSION` | An admin-device session printed by `storage auth export` (URL, device id and key). |
| `STORAGE_SESSION_FILE` | Read STORAGE_SESSION from this file. |
| `STORAGE_FINGERPRINT` | Pin the server's TLS key (SPKI SHA-256, base64url) instead of trusting the system CAs. |
| `STORAGE_CONTEXT` | Saved context to use instead of the current one. |
| `STORAGE_CONFIG_DIR` | Where config.json (the saved contexts) lives. Default: $XDG_CONFIG_HOME/storage (~/.config/storage), %APPDATA%\storage on Windows. |
| `STORAGE_DATA_DIR` | On the server's machine: with no other credentials, read admin.token from this data directory (default: the server's default). |
| `STORAGE_ADMIN_PORT` | On the server's machine: the console port used with the data directory's token (default 8081). |
| `STORAGE_DEBUG` | Set to 1 to print each HTTP request to stderr. |
| `NO_COLOR` | Set to disable ANSI colours. |
| `NODE_EXTRA_CA_CERTS` | Extra CA certificates to trust (a PEM file), read by Node. |
