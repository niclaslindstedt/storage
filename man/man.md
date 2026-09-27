# storage-server man

Print an embedded manual page.

## Synopsis

```
storage-server man [<command>]
```

## Description

With no command, lists the manual pages.

## Options

| Flag | Type | Default | Environment | Description |
|---|---|---|---|---|
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
storage-server man serve
```

## See also

[`storage-server docs`](docs.md), [`storage-server commands`](commands.md)
