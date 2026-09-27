# storage-server backup

Write a consistent copy of the data directory.

## Synopsis

```
storage-server backup --out <dir>
```

## Description

Copies the database (via SQLite VACUUM INTO, safe while serving), all blobs and certificates. Everything user-authored in it is ciphertext. Restore by stopping the server and using the backup as --data-dir.

## Options

| Flag | Type | Default | Environment | Description |
|---|---|---|---|---|
| `--out` | string | — | — | Empty or new directory to write the backup to. |
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
storage-server backup --out /mnt/usb/storage-$(date +%F)
```

nightly from cron

## See also

[`storage-server doctor`](doctor.md)
