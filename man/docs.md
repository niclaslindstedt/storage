# storage-server docs

Print an embedded documentation topic.

## Synopsis

```
storage-server docs [<topic>]
```

## Description

With no topic, lists the topics. Works offline: the docs are compiled into the binary.

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
storage-server docs
```

```sh
storage-server docs home-hosting
```

## See also

[`storage-server man`](man.md), [`storage-server commands`](commands.md)
