# storage-server upnp

Inspect or change router port forwarding.

## Synopsis

```
storage-server upnp <status|map|unmap> [--port <n>] [--external <n>]
```

## Description

Talks to the router via UPnP IGD, falling back to NAT-PMP. `status` also reports whether the router's WAN address is behind carrier-grade or double NAT.

## Subcommands

| Subcommand | Usage | Description |
|---|---|---|
| `status` | `storage-server upnp status` | Find the gateway and its external address. |
| `map` | `storage-server upnp map --port 8443 --external 443` | Add a mapping (lease renewed only while `serve --upnp` runs). |
| `unmap` | `storage-server upnp unmap --external 443` | Remove a mapping. |

## Options

| Flag | Type | Default | Environment | Description |
|---|---|---|---|---|
| `--port` | int | `8443` | — | Internal port. |
| `--external` | int | `443` | — | External port on the router. |
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
storage-server upnp status
```

## See also

[`storage-server serve`](serve.md), [`storage-server doctor`](doctor.md)
