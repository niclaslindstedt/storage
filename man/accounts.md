# storage-server accounts

List, create, update and delete accounts.

## Synopsis

```
storage-server accounts <list|create|update|delete> [<name>] [flags]
```

## Description

Manages who can use the server. Deleting an account deletes every namespace it owns, for all members.

## Subcommands

| Subcommand | Usage | Description |
|---|---|---|
| `list` | `storage-server accounts list [--json]` | List accounts with role, usage and quota. |
| `create` | `storage-server accounts create <name> [--role <role>] [--quota <bytes>]` | Create an account (pair a device to it with `pair`). |
| `update` | `storage-server accounts update <name> [--role <role>] [--quota <bytes>|--unlimited] [--rename <new>] [--disable|--enable]` | Change role, quota, name or disabled state. |
| `delete` | `storage-server accounts delete <name> --yes` | Delete an account and the namespaces it owns. |

## Options

| Flag | Type | Default | Environment | Description |
|---|---|---|---|---|
| `--role` | string | — | — | Account role. |
| `--quota` | int | — | — | Storage quota in bytes. |
| `--unlimited` | bool | — | — | Remove the quota. |
| `--rename` | string | — | — | New account name. |
| `--disable` | bool | — | — | Disable the account (its devices stop working). |
| `--enable` | bool | — | — | Re-enable a disabled account. |
| `--yes` | bool | — | — | Confirm a destructive action. |
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
storage-server accounts list
```

who is on this server

```sh
storage-server accounts create kid --role member --quota 1073741824
```

1 GiB quota

```sh
storage-server accounts update kid --disable
```

lock an account out

## See also

[`storage-server pair`](pair.md), [`storage-server devices`](devices.md)
