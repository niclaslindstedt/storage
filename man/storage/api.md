# storage api

Make an authenticated request to the console API.

## Synopsis

```
storage api <path> [-X <method>] [-f <key=value>]... [-F <key=value>]... [--input <file>]
```

## Description

Like `gh api`: sends a request to any console endpoint with the current credentials and prints the answer (pretty JSON on a terminal). The path is a console path (/api/accounts, /metrics) or short (accounts); with an admin device it is sent to /v1/console/<path>. -f adds a string field, -F a typed one (numbers, true, false, null); fields make a POST unless -X says otherwise. Exits 1 on an error status.

## Options

| Flag | Type | Default | Environment | Description |
|---|---|---|---|---|
| `-X, --method` | string | `GET (POST with fields or --input)` | — | HTTP method. |
| `-f, --field` | list | — | — | Add a string field to the JSON body (repeatable). |
| `-F, --typed-field` | list | — | — | Add a number, boolean or null field (repeatable). |
| `--input` | string | — | — | Send this file ('-' for stdin) as the JSON body. |

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
storage api overview
```

```sh
storage api accounts -f name=kid -f role=guest -F quotaBytes=1073741824
```

create an account

```sh
storage api /api/devices/dev_x -X PATCH -F console=false
```

## See also

[`storage auth`](auth.md)
