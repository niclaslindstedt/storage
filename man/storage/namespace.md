# storage namespace

List namespaces (metadata only — contents are end-to-end encrypted).

## Synopsis

```
storage namespace <ls|view> [<id>] [flags]
```

## Description

The console's Namespaces page: id, app, owner, members and their roles, bytes used, change sequence, key epoch and pending invites. Names and contents are encrypted on the devices and cannot be shown.

Aliases: `storage namespaces`, `storage ns`.

## Subcommands

### ls

List namespaces.

```
storage namespace ls [--app <app>] [--owner <name>] [--json | -q | --format <t>]
```

Aliases: `list`.

| Flag | Type | Default | Environment | Description |
|---|---|---|---|---|
| `--app` | string | — | — | Only this app's namespaces (e.g. meds). |
| `--owner` | string | — | — | Only namespaces this account owns. |
| `--json` | bool | — | — | Print the console API's JSON instead of a table. |
| `-q, --quiet` | bool | — | — | Print only ids (or names), one per line — for piping. |
| `--format` | string | — | — | Print each item with a template: {{.field}} placeholders, {{json .}} for the whole item, \t and \n escapes. |

### view

Show one namespace with its members.

```
storage namespace view <id> [--json]
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
| 0 | success |
| 1 | the request failed (details on stderr) |
| 2 | invalid usage (unknown command, flag or value) |
| 4 | not logged in, or the credentials were rejected |

## Environment

See [`storage`](README.md#environment) for every variable the CLI reads.

## Examples

```sh
storage namespace ls --app meds
```

```sh
storage ns ls --json | jq 'map(.usedBytes) | add'
```

total bytes in namespaces

## See also

[`storage account`](account.md)
