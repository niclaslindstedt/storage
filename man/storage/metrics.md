# storage metrics

Print the Prometheus metrics.

## Synopsis

```
storage metrics
```

## Description

The console's /metrics endpoint in the Prometheus text format — the same numbers a scraper sees.

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
| 0 | success |
| 1 | the request failed (details on stderr) |
| 2 | invalid usage (unknown command, flag or value) |
| 4 | not logged in, or the credentials were rejected |

## Environment

See [`storage`](README.md#environment) for every variable the CLI reads.

## Examples

```sh
storage metrics | grep storage_devices
```

## See also

[`storage traffic`](traffic.md)
