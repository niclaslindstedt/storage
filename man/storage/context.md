# storage context

List, switch, rename and remove saved servers.

## Synopsis

```
storage context <ls|use|show|rename|rm> [<name>]
```

## Description

Every `auth login` saves a context — a server URL plus credentials — in config.json in the config directory ($STORAGE_CONFIG_DIR, default ~/.config/storage). One context is current; -c/--context or STORAGE_CONTEXT picks another for one command.

## Subcommands

### ls

List contexts; the current one is marked with *.

```
storage context ls [--json]
```

Aliases: `list`.

| Flag | Type | Default | Environment | Description |
|---|---|---|---|---|
| `--json` | bool | — | — | Print the console API's JSON instead of a table. |
| `-q, --quiet` | bool | — | — | Print only ids (or names), one per line — for piping. |

### use

Make a context the current one.

```
storage context use <name>
```

### show

Print the name of the context commands will use.

```
storage context show
```

### rename

Rename a context.

```
storage context rename <old> <new>
```

### rm

Forget contexts locally (use `auth logout` to also revoke an admin device).

```
storage context rm <name>...
```

Aliases: `remove`.

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
storage context ls
```

```sh
storage context use home
```

```sh
storage -c cabin status
```

one command against another server

## See also

[`storage auth`](auth.md)
