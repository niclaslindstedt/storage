# storage doctor

Run the server's health checks and print a fix for each problem.

## Synopsis

```
storage doctor [--json]
```

## Description

The console's Troubleshoot checks, run now on the server: data directory, database integrity, audit chain, an admin exists, disk space, certificate, port mapping and NAT, the public URL, network exposure and recent errors. Exits 1 when any check fails.

Aliases: `storage checks`.

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
| 0 | no check failed |
| 1 | a check failed, or the request failed |
| 2 | invalid usage |
| 4 | not logged in, or the credentials were rejected |

## Environment

See [`storage`](README.md#environment) for every variable the CLI reads.

## Examples

```sh
storage doctor
```

## See also

[`storage status`](status.md), [`storage system`](system.md)
