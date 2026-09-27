# storage-server test-server

Run an in-memory server in test mode (for end-to-end tests).

## Synopsis

```
storage-server test-server [--port <n>] [--host <addr>] [--secret <s>]
```

## Description

Starts a throwaway plain-HTTP server with /__test/* controls (reset, snapshot, restore, faults, clock, accounts) and prints one JSON line {url, secret} on stdout. Never holds real data.

## Options

| Flag | Type | Default | Environment | Description |
|---|---|---|---|---|
| `--port` | int | `0` | — | Port (0 = any free port). |
| `--host` | string | `127.0.0.1` | — | Address to listen on. |
| `--secret` | string | — | — | Test secret (random when omitted). |
| `--cors` | string | `any` | — | CORS policy. |
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
storage-server test-server --port 4010 --secret dev
```

for a Playwright webServer

## See also

[`storage-server serve`](serve.md)
