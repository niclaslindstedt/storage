# storage device

List devices, revoke them and remove admin access.

## Synopsis

```
storage device <ls|view|revoke|remove-admin> [<id>...] [flags]
```

## Description

The console's Devices page. Devices are named by id or a unique id prefix. Revoking a device ends its sessions and deletes its copy of the account key at once; rotate shared namespace keys from an app afterwards if it was lost. `remove-admin` takes remote console access away from an admin device (it can never be granted back — pair a new one).

Aliases: `storage devices`.

## Subcommands

### ls

List devices (revoked ones only with --all or --state revoked).

```
storage device ls [--account <name>] [--state <state>] [--admin] [--all] [--json | -q | --format <t>]
```

Aliases: `list`.

| Flag | Type | Default | Environment | Description |
|---|---|---|---|---|
| `--account` | string | — | — | Only this account's devices. |
| `--state` | string | — | — | Only devices in this state. |
| `--admin` | bool | — | — | Only admin devices. |
| `-a, --all` | bool | — | — | Include revoked devices. |
| `--json` | bool | — | — | Print the console API's JSON instead of a table. |
| `-q, --quiet` | bool | — | — | Print only ids (or names), one per line — for piping. |
| `--format` | string | — | — | Print each item with a template: {{.field}} placeholders, {{json .}} for the whole item, \t and \n escapes. |

### view

Show one device.

```
storage device view <id> [--json]
```

| Flag | Type | Default | Environment | Description |
|---|---|---|---|---|
| `--json` | bool | — | — | Print the console API's JSON instead of a table. |

### revoke

Revoke devices.

```
storage device revoke <id>... [--yes]
```

Aliases: `rm`.

| Flag | Type | Default | Environment | Description |
|---|---|---|---|---|
| `-y, --yes` | bool | — | — | Do not ask for confirmation. |

### remove-admin

Take remote console access away from admin devices.

```
storage device remove-admin <id>... [--yes]
```

| Flag | Type | Default | Environment | Description |
|---|---|---|---|---|
| `-y, --yes` | bool | — | — | Do not ask for confirmation. |

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
storage device ls --account niclas
```

```sh
storage device revoke dev_Q2hhbGxl --yes
```

a lost phone

```sh
storage device ls --state pending -q | xargs storage device revoke -y
```

revoke every device that never got its keys

## See also

[`storage account`](account.md), [`storage audit`](audit.md)
