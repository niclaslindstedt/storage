# storage-server serve

Run the storage server (the default command).

## Synopsis

```
storage-server serve [--data-dir <dir>] [--tls <mode>] [--domain <name>]... [--upnp] [flags]
```

## Description

Starts the HTTPS API, the admin console (a local web UI to administer, monitor, read logs and troubleshoot; its sign-in link is printed to stderr) and background housekeeping. On first start, when no account exists, it prints a one-time QR code that enrols the first device as the admin.

## Options

| Flag | Type | Default | Environment | Description |
|---|---|---|---|---|
| `--name` | string | `storage` | `STORAGE_NAME` | Display name shown in pairing QR codes and /v1/info. |
| `--public-url` | string | — | `STORAGE_PUBLIC_URL` | Externally reachable base URL devices use, e.g. https://home.example.org or https://203.0.113.7:443. |
| `--app-url` | string | — | `STORAGE_APP_URL` | Wrap QR payloads as <app-url>#oss=… so a phone camera opens the app directly. |
| `--host` | string | `0.0.0.0 (127.0.0.1 with --tls off)` | `STORAGE_HOST` | Address to listen on. |
| `--port` | int | `8443` | `STORAGE_PORT` | HTTPS (or plain HTTP with --tls off) port. |
| `--http-port` | int | — | `STORAGE_HTTP_PORT` | Plain-HTTP port for ACME http-01 challenges and HTTPS redirects (0 = any free port; unset = disabled). |
| `--admin-port` | int | `8081` | `STORAGE_ADMIN_PORT` | Admin console port (-1 disables). |
| `--admin-host` | string | `127.0.0.1` | `STORAGE_ADMIN_HOST` | Interface the admin console listens on. Keep it on loopback. Only in a container with published ports use 0.0.0.0, published as -p 127.0.0.1:8081:8081. |
| `--remote-console` | string | `on` | `STORAGE_REMOTE_CONSOLE` | Let admin devices (paired with `pair --console` or from the console) use the admin console remotely at /v1/console. Inert until one is paired. |
| `--tls` | string | `self-signed` | `STORAGE_TLS` | How HTTPS certificates are obtained. |
| `--domain` | list | — | `STORAGE_DOMAINS` | DNS name or public IP to certify (repeatable; env is comma-separated). |
| `--acme-email` | string | — | `STORAGE_ACME_EMAIL` | Contact address for the ACME account. |
| `--acme-directory` | string | `https://acme-v02.api.letsencrypt.org/directory` | `STORAGE_ACME_DIRECTORY` | ACME directory URL (use the staging URL while testing). |
| `--acme-profile` | string | — | `STORAGE_ACME_PROFILE` | ACME certificate profile; defaults to shortlived when an IP is certified. |
| `--cert` | string | — | `STORAGE_CERT_FILE` | PEM certificate chain (with --tls files). |
| `--key` | string | — | `STORAGE_KEY_FILE` | PEM private key (with --tls files). |
| `--upnp` | bool | — | `STORAGE_UPNP` | Forward the ports on the home router via UPnP IGD or NAT-PMP. |
| `--upnp-lease` | int | `3600` | `STORAGE_UPNP_LEASE` | Port-mapping lease; renewed at half-life. |
| `--trust-proxy` | bool | — | `STORAGE_TRUST_PROXY` | Trust X-Forwarded-For from a reverse proxy (only behind one). |
| `--cors` | string | `paired` | `STORAGE_CORS` | CORS policy: origins learnt at pairing (plus --cors-origin), or any origin. |
| `--cors-origin` | list | — | `STORAGE_CORS_ORIGINS` | Always-allowed app origin (repeatable; env is comma-separated). |
| `--default-quota` | int | — | `STORAGE_DEFAULT_QUOTA` | Storage quota for new non-admin accounts (unset = unlimited). |
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

- `STORAGE_NAME`
- `STORAGE_PUBLIC_URL`
- `STORAGE_APP_URL`
- `STORAGE_HOST`
- `STORAGE_PORT`
- `STORAGE_HTTP_PORT`
- `STORAGE_ADMIN_PORT`
- `STORAGE_ADMIN_HOST`
- `STORAGE_REMOTE_CONSOLE`
- `STORAGE_TLS`
- `STORAGE_DOMAINS`
- `STORAGE_ACME_EMAIL`
- `STORAGE_ACME_DIRECTORY`
- `STORAGE_ACME_PROFILE`
- `STORAGE_CERT_FILE`
- `STORAGE_KEY_FILE`
- `STORAGE_UPNP`
- `STORAGE_UPNP_LEASE`
- `STORAGE_TRUST_PROXY`
- `STORAGE_CORS`
- `STORAGE_CORS_ORIGINS`
- `STORAGE_DEFAULT_QUOTA`
- `STORAGE_DATA_DIR`
- `STORAGE_DEBUG`

## Examples

```sh
storage-server serve --data-dir ~/storage
```

self-signed HTTPS on :8443 (native apps pin it via the QR code)

```sh
storage-server serve --tls acme --domain home.example.org --http-port 80 --port 443 --upnp
```

home server with a Let's Encrypt certificate and automatic port forwarding

```sh
storage-server serve --tls acme --domain 203.0.113.7 --port 443 --upnp
```

no domain: a short-lived IP certificate validated with tls-alpn-01

```sh
storage-server serve --tls off --host 127.0.0.1 --port 8080 --trust-proxy --public-url https://storage.example.org
```

behind Caddy, nginx or a tunnel

## See also

[`storage-server setup`](setup.md), [`storage-server pair`](pair.md), [`storage-server admin`](admin.md), [`storage-server doctor`](doctor.md)
