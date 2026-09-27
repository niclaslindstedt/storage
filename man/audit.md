# storage-server audit

Verify or read the tamper-evident audit log.

## Synopsis

```
storage-server audit <verify|tail> [--limit <n>] [--json]
```

## Description

Every security-relevant event (pairing, auth failures, revocations, sharing, key rotation, deletions) is hash-chained; `verify` recomputes the chain and reports the first broken entry.

## Subcommands

| Subcommand | Usage | Description |
|---|---|---|
| `verify` | `storage-server audit verify` | Recompute the hash chain; exit 1 if it is broken. |
| `tail` | `storage-server audit tail [--limit <n>] [--json]` | Show the newest entries. |

## Options

| Flag | Type | Default | Environment | Description |
|---|---|---|---|---|
| `--limit` | int | `50` | — | Entries to show. |
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
storage-server audit verify
```

```sh
storage-server audit tail --limit 20
```

## See also

[`storage-server doctor`](doctor.md)
