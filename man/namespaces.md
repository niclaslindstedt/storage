# storage-server namespaces

List namespaces (metadata only — contents are end-to-end encrypted).

## Synopsis

```
storage-server namespaces list [--json]
```

## Description

Shows id, app, owner, member count, bytes used and change sequence. Names are encrypted and cannot be shown.

## Subcommands

| Subcommand | Usage | Description |
|---|---|---|
| `list` | `storage-server namespaces list [--json]` | List namespaces. |

## Options

| Flag | Type | Default | Environment | Description |
|---|---|---|---|---|
| `--json` | bool | — | — | Machine-readable output. |
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

- `STORAGE_DATA_DIR`
- `STORAGE_DEBUG`

## Examples

```sh
storage-server namespaces list --json | jq '.[] | select(.app=="meds")'
```

## See also

[`storage-server accounts`](accounts.md)
