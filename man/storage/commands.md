# storage commands

List commands in a stable, grep-friendly format.

## Synopsis

```
storage commands [<name>] [--examples]
```

## Description

With no name, one line per command. With a name, that command's subcommands, flags and exit codes. --examples adds example invocations.

## Options

| Flag | Type | Default | Environment | Description |
|---|---|---|---|---|
| `--examples` | bool | — | — | Show example invocations. |

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
storage commands
```

```sh
storage commands account
```

## See also

[`storage help`](help.md)
