# storage-server admin

Print the admin console sign-in link, or rotate its token.

## Synopsis

```
storage-server admin [--rotate] [--json]
```

## Description

The admin console is a local web UI that serve starts on 127.0.0.1:8081 (see --admin-host and --admin-port). It is unlocked by a token kept in admin.token in the data directory; this command prints a sign-in link carrying it. --rotate replaces the token, which signs out every open console session immediately (no restart needed).

## Options

| Flag | Type | Default | Environment | Description |
|---|---|---|---|---|
| `--rotate` | bool | — | — | Replace the admin token and end every console session. |
| `--json` | bool | — | — | Print JSON. |
| `--admin-port` | int | `8081` | `STORAGE_ADMIN_PORT` | Admin console port (-1 disables). |
| `--admin-host` | string | `127.0.0.1` | `STORAGE_ADMIN_HOST` | Interface the admin console listens on. Keep it on loopback. Only in a container with published ports use 0.0.0.0, published as -p 127.0.0.1:8081:8081. |
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

- `STORAGE_ADMIN_PORT`
- `STORAGE_ADMIN_HOST`
- `STORAGE_DATA_DIR`
- `STORAGE_DEBUG`

## Examples

```sh
storage-server admin
```

open the printed link in a browser on this machine

```sh
ssh -L 8081:127.0.0.1:8081 pi@homeserver
```

reach a home server's console from your laptop

```sh
storage-server admin --rotate
```

after sharing a link by mistake

```sh
docker exec storage /nodejs/bin/node /app/dist/cli.js admin
```

in the container

## See also

[`storage-server serve`](serve.md), [`storage-server doctor`](doctor.md)
