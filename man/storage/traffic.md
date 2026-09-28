# storage traffic

Requests, errors and latency per minute and per route.

## Synopsis

```
storage traffic [--minutes <n>] [--json]
```

## Description

The console's Traffic page: totals since start, latency percentiles, live SSE connections, a per-minute table (the last 60 minutes are kept) and the per-route table.

## Options

| Flag | Type | Default | Environment | Description |
|---|---|---|---|---|
| `-n, --minutes` | int | `15` | — | Minutes of the per-minute table to show. |
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
| 0 | success |
| 1 | the request failed (details on stderr) |
| 2 | invalid usage (unknown command, flag or value) |
| 4 | not logged in, or the credentials were rejected |

## Environment

See [`storage`](README.md#environment) for every variable the CLI reads.

## Examples

```sh
storage traffic
```

```sh
storage traffic --json | jq '.routes | sort_by(-.count) | .[0]'
```

the busiest route

## See also

[`storage metrics`](metrics.md), [`storage status`](status.md)
