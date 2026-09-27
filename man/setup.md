# storage-server setup

Create the first admin pairing and print its QR code.

## Synopsis

```
storage-server setup [--account <name>] [--ttl <seconds>] [--public-url <url>]
```

## Description

Mints a one-time code that creates the admin account when a device redeems it. Refuses when an admin already exists.

## Options

| Flag | Type | Default | Environment | Description |
|---|---|---|---|---|
| `--account` | string | `admin` | — | Name of the admin account to create. |
| `--ttl` | int | `600` | — | How long the code stays valid. |
| `--no-qr` | bool | — | — | Print only the payload, no QR code. |
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
storage-server setup --account niclas --public-url https://home.example.org
```

first-time setup

## See also

[`storage-server pair`](pair.md), [`storage-server serve`](serve.md)
