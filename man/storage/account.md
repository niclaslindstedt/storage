# storage account

List, create, edit, pair and delete accounts.

## Synopsis

```
storage account <ls|view|create|edit|pair|rm> [<name>] [flags]
```

## Description

The console's Accounts page. Accounts are named by name or id. Deleting an account deletes every namespace it owns, for all members, so it asks you to type the account's name (or pass --yes). Quotas take bytes or a size with a unit: 500M, 10G, 1T (powers of 1024).

Aliases: `storage accounts`.

## Subcommands

### ls

List accounts with role, usage, quota, devices and state.

```
storage account ls [--role <role>] [--json | -q | --format <t>]
```

Aliases: `list`.

| Flag | Type | Default | Environment | Description |
|---|---|---|---|---|
| `--role` | string | — | — | Only this role. |
| `--json` | bool | — | — | Print the console API's JSON instead of a table. |
| `-q, --quiet` | bool | — | — | Print only ids (or names), one per line — for piping. |
| `--format` | string | — | — | Print each item with a template: {{.field}} placeholders, {{json .}} for the whole item, \t and \n escapes. |

### view

Show one account, with its devices and namespaces.

```
storage account view <name> [--json]
```

| Flag | Type | Default | Environment | Description |
|---|---|---|---|---|
| `--json` | bool | — | — | Print the console API's JSON instead of a table. |

### create

Create an account; --pair also prints a QR code for its first device.

```
storage account create <name> [--role <role>] [--quota <size>] [--pair]
```

| Flag | Type | Default | Environment | Description |
|---|---|---|---|---|
| `--role` | string | `member` | — | Account role. |
| `--quota` | string | — | — | Storage quota (e.g. 10G). |
| `--pair` | bool | — | — | Also mint a pairing for the account's first device. |
| `--no-qr` | bool | — | — | Print only the pairing payload, no QR code. |
| `--json` | bool | — | — | Print the console API's JSON instead of a table. |

### edit

Rename, change role or quota, disable or enable.

```
storage account edit <name> [--name <new>] [--role <role>] [--quota <size> | --unlimited] [--disable | --enable]
```

| Flag | Type | Default | Environment | Description |
|---|---|---|---|---|
| `--name` | string | — | — | New account name. |
| `--role` | string | — | — | Account role. |
| `--quota` | string | — | — | New storage quota (e.g. 10G). |
| `--unlimited` | bool | — | — | Remove the quota. |
| `--disable` | bool | — | — | Disable the account (its devices stop working). |
| `--enable` | bool | — | — | Re-enable a disabled account. |
| `--json` | bool | — | — | Print the console API's JSON instead of a table. |

### pair

Print a one-time QR code that pairs a device to an account (or creates the account).

```
storage account pair <name> [--admin-app] [--agent [--perms <list>] [--apps <list>]] | --new <name> [--role <role>]  [--no-qr] [--json]
```

| Flag | Type | Default | Environment | Description |
|---|---|---|---|---|
| `--new` | string | — | — | Create this account when the code is redeemed. |
| `--role` | string | `member` | — | Role of the --new account. |
| `--admin-app` | bool | — | — | Pair an admin device (Storage Remote, or another `storage` CLI). Admin accounts only, and only when logged in with the admin token: remote access is granted at the machine. |
| `--agent` | bool | — | — | Pair an agent device (an AI agent's `storage-mcp`, a script), held by the server to --perms and --apps on every request. |
| `--perms` | string | — | — | Comma-separated agent permissions: data:read (the default), data:write, sharing, devices; with --admin-app also console:read, console:write. |
| `--apps` | string | — | — | Comma-separated app ids the agent may see, e.g. drive,notes (default: all). |
| `--no-qr` | bool | — | — | Print only the pairing payload, no QR code. |
| `--json` | bool | — | — | Print the console API's JSON instead of a table. |

### rm

Delete an account and every namespace it owns.

```
storage account rm <name> [--yes]
```

Aliases: `delete`.

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
storage account ls
```

who is on this server

```sh
storage account create grandma --quota 10G --pair
```

a new family member, with a QR code for her phone

```sh
storage account pair niclas --agent --perms data:read --apps drive --no-qr
```

a code for `storage-mcp pair`: an AI agent that may read the drive

```sh
storage account edit kid --disable
```

lock an account out

```sh
storage account pair niclas --admin-app
```

pair Storage Remote as an admin device (admin token only)

```sh
storage account ls --role guest -q
```

names only, for a script

## See also

[`storage device`](device.md), [`storage namespace`](namespace.md)
