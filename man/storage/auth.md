# storage auth

Log in to a storage server, show and export credentials.

## Synopsis

```
storage auth <login|logout|status|token|export> [flags]
```

## Description

Two ways in. On the server's machine (or through an SSH tunnel), log in to the admin console listener with its admin token: paste the link `storage-server admin` prints, or pipe the token with --with-token. From anywhere else, log in as an admin device: run `storage-server pair --account <admin> --console` (or use "Pair admin app" in the console) and pass the printed oss-storage:// payload; the CLI creates a device key, keeps it in its config file (mode 0600), and signs in with it over the server's HTTPS API. Each login is saved as a context. For scripts and containers, `auth export` prints the credentials as STORAGE_* lines for a .env file.

## Subcommands

### login

Save a server: with the admin token (console link) or by pairing an admin device.

```
storage auth login [<sign-in-link|pairing-payload>] [--url <url>] [--with-token | --code <code>] [--name <device-name>] [-c <context>]
```

| Flag | Type | Default | Environment | Description |
|---|---|---|---|---|
| `--url` | string | — | — | Console URL for --with-token (default http://127.0.0.1:8081), or the server URL for --code. |
| `--with-token` | bool | — | — | Read the admin token from standard input. |
| `--code` | string | — | — | An admin-device pairing code (with --url). |
| `--fingerprint` | string | — | `STORAGE_FINGERPRINT` | Pin the server's TLS key (SPKI SHA-256, base64url) — for a self-signed certificate. Pairing payloads carry it. |
| `--name` | string | `storage CLI on <hostname>` | — | Name of the admin device the server lists. |

### logout

Forget a context; an admin device is also revoked on the server.

```
storage auth logout [-c <context>] [--keep-device]
```

| Flag | Type | Default | Environment | Description |
|---|---|---|---|---|
| `--keep-device` | bool | — | — | Do not revoke the admin device (its exported session keeps working). |

### status

Show where the credentials come from and whether they are accepted.

```
storage auth status [--json]
```

| Flag | Type | Default | Environment | Description |
|---|---|---|---|---|
| `--json` | bool | — | — | Print the console API's JSON instead of a table. |

### token

Print a bearer token for curl: the admin token, or a 10-minute admin-device token.

```
storage auth token
```

### export

Print the current credentials as .env lines (STORAGE_URL, STORAGE_TOKEN or STORAGE_SESSION).

```
storage auth export
```

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
storage auth login "$(storage-server admin)"
```

on the server: log in with the console's sign-in link

```sh
ssh pi@home cat /var/lib/storage/admin.token | storage auth login --with-token
```

through an SSH tunnel to 127.0.0.1:8081

```sh
storage auth login 'oss-storage://pair?v=1&s=https%3A%2F%2Fhome.example.org&c=…'
```

anywhere: pair the CLI as an admin device

```sh
storage auth export >> .env && chmod 600 .env
```

hand the session to a script or a container

## See also

[`storage context`](context.md), [`storage status`](status.md)
