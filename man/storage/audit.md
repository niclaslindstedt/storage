# storage audit

Read and verify the tamper-evident audit log.

## Synopsis

```
storage audit <ls|verify> [flags]
```

## Description

The console's Audit page. Every security-relevant event (pairing, sign-in failures, revocations, sharing, key rotation, deletions, console changes) is hash-chained; `verify` recomputes the chain and exits 1 when it is broken.

## Subcommands

### ls

Show the newest entries.

```
storage audit ls [--action <action>] [--before <id>] [-n <n>] [--json | --format <t>]
```

Aliases: `list`.

| Flag | Type | Default | Environment | Description |
|---|---|---|---|---|
| `--action` | string | — | — | Only this action or family, e.g. device or device.revoke. |
| `--before` | int | — | — | Only entries older than this id (paging). |
| `-n, --limit` | int | `50` | — | Entries to show (max 500). |
| `--json` | bool | — | — | Print the console API's JSON instead of a table. |
| `--format` | string | — | — | Print each item with a template: {{.field}} placeholders, {{json .}} for the whole item, \t and \n escapes. |

### verify

Recompute the hash chain; exit 1 if it is broken.

```
storage audit verify [--json]
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
| 0 | success (verify: the chain is intact) |
| 1 | the chain is broken, or the request failed |
| 2 | invalid usage |
| 4 | not logged in, or the credentials were rejected |

## Environment

See [`storage`](README.md#environment) for every variable the CLI reads.

## Examples

```sh
storage audit ls --action device -n 20
```

```sh
storage audit verify
```

## See also

[`storage logs`](logs.md), [`storage doctor`](doctor.md)
