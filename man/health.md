# storage-server health

Probe the local server (for container and service health checks).

## Synopsis

```
storage-server health [--port <n>] [--tls <mode>]
```

## Description

Requests /v1/info on 127.0.0.1 and exits 0 when the server answers. Liveness only: it sends no credentials, so it skips certificate verification.

## Options

| Flag | Type | Default | Environment | Description |
|---|---|---|---|---|
| `--port` | int | `8443` | `STORAGE_PORT` | HTTPS (or plain HTTP with --tls off) port. |
| `--tls` | string | `self-signed` | `STORAGE_TLS` | How HTTPS certificates are obtained. |
| `--data-dir` | string | `$XDG_DATA_HOME/storage-server (~/.local/share/storage-server)` | `STORAGE_DATA_DIR` | Directory holding the database, blobs, certificates and config.json. |
| `--debug` | bool | — | `STORAGE_DEBUG` | Also print debug-level log lines to stderr. |
| `--help` | bool | — | — | Show help for the command. |
| `--version` | bool | — | — | Print the version and exit. |

## Exit codes

| Code | Meaning |
|---|---|
| 0 | the server answered |
| 1 | no answer or an error status |
| 2 | invalid usage |

## Environment

- `STORAGE_PORT`
- `STORAGE_TLS`
- `STORAGE_DATA_DIR`
- `STORAGE_DEBUG`

## Examples

```sh
storage-server health --port 8443
```

Docker HEALTHCHECK

## See also

[`storage-server doctor`](doctor.md), [`storage-server serve`](serve.md)
