# storage settings

How long earlier file versions and deleted files are kept.

## Synopsis

```
storage settings <show|set|reset> [flags]
```

## Description

The console's Settings page. When a file is overwritten, the server keeps the version it replaced for --history-days (default 30) after the replacement, at most --history-versions per file; deleted files wait in the trash for --trash-days. A value set here wins over the server's configuration (flags, environment, config.json) and applies at once; `reset` goes back to the configuration's value. The versions stay encrypted: only the account's devices can open or compare them.

## Subcommands

### show

Print the settings and where each comes from.

```
storage settings show [--json]
```

| Flag | Type | Default | Environment | Description |
|---|---|---|---|---|
| `--json` | bool | — | — | Print the console API's JSON instead of a table. |

### set

Change one or more settings.

```
storage settings set [--history-days <days>] [--history-versions <n>] [--trash-days <days>] [--json]
```

| Flag | Type | Default | Environment | Description |
|---|---|---|---|---|
| `--history-days` | int | — | — | Keep a replaced version this many days (0 = keep none). |
| `--history-versions` | int | — | — | Keep at most this many versions per file. |
| `--trash-days` | int | — | — | Keep deleted files this many days. |
| `--json` | bool | — | — | Print the console API's JSON instead of a table. |

### reset

Go back to the server configuration's value.

```
storage settings reset <history-days|history-versions|trash-days>... [--json]
```

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
| 0 | success |
| 1 | the request failed (details on stderr) |
| 2 | invalid usage (unknown command, flag or value) |
| 4 | not logged in, or the credentials were rejected |

## Environment

See [`storage`](README.md#environment) for every variable the CLI reads.

## Examples

```sh
storage settings set --history-days 90
```

```sh
storage settings reset history-days
```

```sh
storage settings show --json | jq .retention
```

## See also

[`storage system`](system.md)
