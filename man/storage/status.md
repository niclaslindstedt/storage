# storage status

Health, uptime, URLs, TLS, port mapping, storage, counts and traffic at a glance.

## Synopsis

```
storage status [--json]
```

## Description

The console's Overview page: the health verdict and its problems, version and uptime, the public URL, the certificate, the router mapping, disk and database use, account/device/namespace counts, traffic totals and latency, log problem counts and the audit chain. Exits 1 when the health verdict is fail.

Aliases: `storage overview`, `storage info`.

## Options

| Flag | Type | Default | Environment | Description |
|---|---|---|---|---|
| `--json` | bool | — | — | Print the console API's JSON instead of a table. |

## Global options

| Flag | Type | Default | Environment | Description |
|---|---|---|---|---|
| `-c, --context` | string | — | `STORAGE_CONTEXT` | Saved server to talk to (see `storage context ls`); overrides the current one. |
| `--env-file` | list | `.env (when present)` | — | Read variables from this file (repeatable). The environment wins over the file. |
| `--no-color` | bool | — | `NO_COLOR` | Plain output without ANSI colours. |
| `--debug` | bool | — | `STORAGE_DEBUG` | Print each HTTP request and its status to stderr. |
| `-h, --help` | bool | — | — | Show help for the command. |

## Exit codes

| Code | Meaning |
|---|---|
| 0 | the server is healthy (or only warns) |
| 1 | a health check fails, or the request failed |
| 2 | invalid usage |
| 4 | not logged in, or the credentials were rejected |

## Environment

See [`storage`](README.md#environment) for every variable the CLI reads.

## Examples

```sh
storage status
```

```sh
storage status --json | jq .tls.daysLeft
```

days until the certificate expires

## See also

[`storage doctor`](doctor.md), [`storage traffic`](traffic.md)
