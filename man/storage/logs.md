# storage logs

Show or follow the server log; download the debug log file.

## Synopsis

```
storage logs [-f] [--level <level>] [--grep <text>] [-n <lines>] [--json] | storage logs download [-o <file>]
```

## Description

The console's Logs page: the server's in-memory log (the last 2000 entries). -f keeps streaming new entries until interrupted, like `docker logs -f`. `download` fetches the always-on debug log file (its last 5 MiB).

## Subcommands

### show

Print recent entries; -f follows.

```
storage logs [-f] [--level <level>] [--grep <text>] [-n <lines>] [--json]
```

| Flag | Type | Default | Environment | Description |
|---|---|---|---|---|
| `-f, --follow` | bool | — | — | Keep streaming new entries. |
| `-l, --level` | string | — | — | Only this level and above. |
| `-g, --grep` | string | — | — | Only entries containing this text (case-insensitive). |
| `-n, --tail` | int | `100` | — | Entries to print before following (max 2000). |
| `--json` | bool | — | — | One JSON object per line. |

### download

Save the server's debug log file.

```
storage logs download [-o <file>]
```

| Flag | Type | Default | Environment | Description |
|---|---|---|---|---|
| `-o, --output` | string | `storage-debug.log` | — | Write to this file ('-' for stdout). |

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
storage logs -f --level warn
```

watch for problems

```sh
storage logs --grep acme -n 500
```

```sh
storage logs download -o - | less
```

## See also

[`storage audit`](audit.md), [`storage doctor`](doctor.md)
