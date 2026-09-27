# storage-server cert

Show or renew the TLS certificate.

## Synopsis

```
storage-server cert <status|renew> [server flags]
```

## Description

`status` prints the mode, identifiers, key fingerprint and expiry. `renew` forces an ACME renewal (the running server renews automatically).

## Subcommands

| Subcommand | Usage | Description |
|---|---|---|
| `status` | `storage-server cert status` | Show the current certificate. |
| `renew` | `storage-server cert renew --tls acme --domain <name> --http-port 80` | Obtain a new ACME certificate now. |

## Options

| Flag | Type | Default | Environment | Description |
|---|---|---|---|---|
| `--http-port` | int | — | `STORAGE_HTTP_PORT` | Plain-HTTP port for ACME http-01 challenges and HTTPS redirects (0 = any free port; unset = disabled). |
| `--tls` | string | `self-signed` | `STORAGE_TLS` | How HTTPS certificates are obtained. |
| `--domain` | list | — | `STORAGE_DOMAINS` | DNS name or public IP to certify (repeatable; env is comma-separated). |
| `--acme-email` | string | — | `STORAGE_ACME_EMAIL` | Contact address for the ACME account. |
| `--acme-directory` | string | `https://acme-v02.api.letsencrypt.org/directory` | `STORAGE_ACME_DIRECTORY` | ACME directory URL (use the staging URL while testing). |
| `--acme-profile` | string | — | `STORAGE_ACME_PROFILE` | ACME certificate profile; defaults to shortlived when an IP is certified. |
| `--cert` | string | — | `STORAGE_CERT_FILE` | PEM certificate chain (with --tls files). |
| `--key` | string | — | `STORAGE_KEY_FILE` | PEM private key (with --tls files). |
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

- `STORAGE_HTTP_PORT`
- `STORAGE_TLS`
- `STORAGE_DOMAINS`
- `STORAGE_ACME_EMAIL`
- `STORAGE_ACME_DIRECTORY`
- `STORAGE_ACME_PROFILE`
- `STORAGE_CERT_FILE`
- `STORAGE_KEY_FILE`
- `STORAGE_DATA_DIR`
- `STORAGE_DEBUG`

## Examples

```sh
storage-server cert status
```

## See also

[`storage-server serve`](serve.md), [`storage-server doctor`](doctor.md)
