# storage-server devices

List and revoke devices.

## Synopsis

```
storage-server devices <list|revoke> [flags]
```

## Description

Revoking a device ends its sessions and deletes its copy of the account key at once. Rotate shared namespace keys from an app afterwards if the device was lost.

## Subcommands

| Subcommand | Usage | Description |
|---|---|---|
| `list` | `storage-server devices list [--account <name>] [--json]` | List devices (all, or one account's). |
| `revoke` | `storage-server devices revoke <device-id>` | Revoke a device. |

## Options

| Flag | Type | Default | Environment | Description |
|---|---|---|---|---|
| `--account` | string | — | — | Only this account's devices. |
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
storage-server devices list --account niclas
```

```sh
storage-server devices revoke dev_Q2hhbGxlbmdlLWNvZGUtM
```

a lost phone

## See also

[`storage-server accounts`](accounts.md), [`storage-server audit`](audit.md)
