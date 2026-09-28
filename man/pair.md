# storage-server pair

Print a one-time QR code that enrols a device.

## Synopsis

```
storage-server pair (--account <name> | --new <name> [--role <role>]) [--console] [--agent [--perms <list>] [--apps <list>]] [--ttl <seconds>] [--json]
```

## Description

Pairs a device to an existing account, or creates a new account on redemption. The code only signs the device in: encryption keys come from the recovery key or from another device, never from the server. With --console the device becomes an admin device that may use the admin console remotely (the remote app); only an admin account can have one, and only this command or the local console can pair one. With --agent the device becomes an agent device (an AI agent's MCP server, a script): the server holds it to the permissions in --perms and the apps in --apps on every request, and its scope can later be narrowed but never widened.

## Options

| Flag | Type | Default | Environment | Description |
|---|---|---|---|---|
| `--account` | string | — | — | Existing account to add a device to. |
| `--new` | string | — | — | Create this account when the code is redeemed. |
| `--role` | string | `member` | — | Role of the new account. |
| `--ttl` | int | `600` | — | How long the code stays valid. |
| `--no-qr` | bool | — | — | Print only the payload, no QR code. |
| `--json` | bool | — | — | Print {code, uri, expiresAt} as JSON. |
| `--console` | bool | — | — | Pair an admin device: it may use the admin console remotely (admin accounts only). |
| `--agent` | bool | — | — | Pair an agent device, held to --perms and --apps by the server (see `docs mcp`). |
| `--perms` | string | `data:read (+ console:read with --console)` | — | Comma-separated agent permissions: data:read, data:write, sharing, devices, console:read, console:write. |
| `--apps` | string | — | — | Comma-separated app ids whose namespaces the agent may see (default: all), e.g. drive,notes. |
| `--name` | string | `storage` | `STORAGE_NAME` | Display name shown in pairing QR codes and /v1/info. |
| `--public-url` | string | — | `STORAGE_PUBLIC_URL` | Externally reachable base URL devices use, e.g. https://home.example.org or https://203.0.113.7:443. |
| `--app-url` | string | — | `STORAGE_APP_URL` | Wrap QR payloads as <app-url>#oss=… so a phone camera opens the app directly. |
| `--port` | int | `8443` | `STORAGE_PORT` | HTTPS (or plain HTTP with --tls off) port. |
| `--tls` | string | `self-signed` | `STORAGE_TLS` | How HTTPS certificates are obtained. |
| `--data-dir` | string | `$XDG_DATA_HOME/storage-server (~/.local/share/storage-server)` | `STORAGE_DATA_DIR` | Directory holding the database, blobs, certificates and config.json. |
| `--debug` | bool | — | `STORAGE_DEBUG` | Also print debug-level log lines to stderr. |
| `--help` | bool | — | — | Show help for the command. |
| `--version` | bool | — | — | Print the version and exit. |

## Exit codes

| Code | Meaning |
|---|---|
| 0 | success |
| 1 | the operation failed (details on stderr) |
| 2 | invalid usage (unknown command, flag or value) |

## Environment

- `STORAGE_NAME`
- `STORAGE_PUBLIC_URL`
- `STORAGE_APP_URL`
- `STORAGE_PORT`
- `STORAGE_TLS`
- `STORAGE_DATA_DIR`
- `STORAGE_DEBUG`

## Examples

```sh
storage-server pair --account niclas
```

add a phone to an existing account

```sh
storage-server pair --account niclas --console
```

pair the remote admin app on your phone

```sh
storage-server pair --account niclas --agent --perms data:read --apps drive
```

pair an AI agent (storage-mcp) that may only read the drive

```sh
storage-server pair --new grandma --role member --ttl 3600
```

a new family member

```sh
storage-server pair --account niclas --json | jq -r .uri
```

script it

## See also

[`storage-server setup`](setup.md), [`storage-server accounts`](accounts.md), [`storage-server devices`](devices.md)
