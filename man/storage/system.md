# storage system

Configuration, housekeeping, backups, certificate renewal, port mapping and diagnostics.

## Synopsis

```
storage system <config|housekeeping|backup|renew-cert|refresh-ports|diagnostics> [flags]
```

## Description

The console's Troubleshoot actions. `backup` writes a consistent copy into backups/ in the server's data directory. `diagnostics` downloads the bug-report bundle: overview, checks, redacted configuration, traffic and the last 500 log entries — no tokens, codes or user content.

## Subcommands

### config

Print the effective (redacted) server configuration.

```
storage system config [--json]
```

| Flag | Type | Default | Environment | Description |
|---|---|---|---|---|
| `--json` | bool | — | — | Print the console API's JSON instead of a table. |

### housekeeping

Purge expired trash, tombstones and uploads now.

```
storage system housekeeping [--json]
```

| Flag | Type | Default | Environment | Description |
|---|---|---|---|---|
| `--json` | bool | — | — | Print the console API's JSON instead of a table. |

### backup

Write a backup into the server's data directory.

```
storage system backup [--json]
```

| Flag | Type | Default | Environment | Description |
|---|---|---|---|---|
| `--json` | bool | — | — | Print the console API's JSON instead of a table. |

### renew-cert

Obtain a new ACME certificate now (--tls acme only).

```
storage system renew-cert [--json]
```

| Flag | Type | Default | Environment | Description |
|---|---|---|---|---|
| `--json` | bool | — | — | Print the console API's JSON instead of a table. |

### refresh-ports

Renew the router port mapping now (--upnp only).

```
storage system refresh-ports [--json]
```

| Flag | Type | Default | Environment | Description |
|---|---|---|---|---|
| `--json` | bool | — | — | Print the console API's JSON instead of a table. |

### diagnostics

Save the diagnostics bundle for a bug report.

```
storage system diagnostics [-o <file>]
```

| Flag | Type | Default | Environment | Description |
|---|---|---|---|---|
| `-o, --output` | string | `storage-diagnostics-<time>.json` | — | Write to this file ('-' for stdout). |

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
storage system config --json | jq .tls
```

```sh
storage system backup
```

```sh
storage system diagnostics -o report.json
```

## See also

[`storage doctor`](doctor.md), [`storage status`](status.md)
