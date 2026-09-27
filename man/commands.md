# storage-server commands

List commands in a stable, grep-friendly format.

## Synopsis

```
storage-server commands [<name>] [--examples]
```

## Description

With no name, one line per command. With a name, that command's full flag and exit-code specification. --examples adds example invocations.

## Options

| Flag | Type | Default | Environment | Description |
|---|---|---|---|---|
| `--examples` | bool | — | — | Show example invocations. |
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
storage-server commands
```

```sh
storage-server commands pair
```

```sh
storage-server commands --examples | grep -A3 upnp
```

## See also

[`storage-server man`](man.md), [`storage-server docs`](docs.md)
