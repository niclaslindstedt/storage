# Configuration

Every setting can be given as a command-line flag, an environment variable,
or a key in `config.json` inside the data directory. Precedence:

**flags > environment (`STORAGE_*`) > `<data-dir>/config.json` > defaults**

`storage-server man serve` lists every flag with its variable and default;
`storage-server --debug-agent` prints the resolved paths.

## Data directory

| Platform     | Default                                                           |
| ------------ | ----------------------------------------------------------------- |
| Linux        | `$XDG_DATA_HOME/storage-server` (`~/.local/share/storage-server`) |
| macOS        | `~/Library/Application Support/storage-server`                    |
| Windows      | `%APPDATA%\storage-server`                                        |
| Docker image | `/data`                                                           |

It holds `storage.db` (SQLite, WAL mode), `blobs/` (content-addressed
ciphertext), `tls/` (certificates, ACME account key), `admin.token` (the
[admin console](admin-console.md) token), `backups/` (backups made from the
console) and optionally `config.json`. Everything user-authored in it is ciphertext, but it also
holds your TLS private key — keep it private (`0700`, which the server
enforces for directories it creates) and back it up with `storage-server
backup`.

## config.json

The keys mirror the server configuration object:

```json
{
  "name": "home",
  "publicUrl": "https://home.example.org",
  "listen": {
    "host": "0.0.0.0",
    "port": 443,
    "httpPort": 80,
    "adminPort": 8081,
    "adminHost": "127.0.0.1"
  },
  "tls": {
    "mode": "acme",
    "domains": ["home.example.org"],
    "acmeEmail": "me@example.org"
  },
  "upnp": { "enabled": true, "leaseSeconds": 3600 },
  "cors": { "mode": "paired", "origins": ["https://notes.example.org"] },
  "defaultQuotaBytes": 10737418240,
  "remoteConsole": true,
  "retention": {
    "historyCount": 100,
    "historyDays": 30,
    "trashDays": 30,
    "tombstoneDays": 90
  }
}
```

Keys only settable in `config.json`: `limits.*` (body, file, part, record and
metadata sizes), `ttl.*` (token, challenge, pairing, invite and upload
lifetimes), `retention.tombstoneDays` and `rateLimit.*`.

## TLS modes

| `--tls`                 | Use when                                                                                                                                       |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `self-signed` (default) | Trying it out; native app wrappers (they pin the key from the QR code). Browsers will not connect.                                             |
| `acme`                  | Public server. `--domain` names a DNS name or a public IP. Needs port 80 (`--http-port 80`, `http-01`) or 443 (`tls-alpn-01`) reachable.       |
| `files`                 | You manage certificates (`--cert`, `--key`); reloaded on change.                                                                               |
| `off`                   | Behind Caddy, nginx, Traefik, Cloudflare Tunnel or Tailscale Funnel. Listens on 127.0.0.1 unless `--host` says otherwise; add `--trust-proxy`. |

## Version history

When a file is overwritten, the server keeps the version it replaced, so
apps can show, compare and restore earlier versions.

| Flag                     | Environment                | `config.json`            | Default | Means                                                              |
| ------------------------ | -------------------------- | ------------------------ | ------- | ------------------------------------------------------------------ |
| `--history-days <days>`  | `STORAGE_HISTORY_DAYS`     | `retention.historyDays`  | 30      | Keep a replaced version this long after it was replaced (0 = none) |
| `--history-versions <n>` | `STORAGE_HISTORY_VERSIONS` | `retention.historyCount` | 100     | At most this many versions per file                                |
| `--trash-days <days>`    | `STORAGE_TRASH_DAYS`       | `retention.trashDays`    | 30      | Keep deleted files in the trash this long                          |

These are the defaults. An admin can change all three at runtime from the
console's [Settings](admin-console.md#settings) page, `storage settings
set` ([CLI](cli.md)) or an agent's `update_settings`. A value changed there
is stored in the database, wins over the configuration, and survives
restarts. `storage settings reset` goes back to the configuration. Apps
read the effective values from `/v1/info` (`retention`).

## Remote console

`--remote-console on|off` (`STORAGE_REMOTE_CONSOLE`, `"remoteConsole"` in
`config.json`; default `on`) lets admin devices use the admin console from
anywhere through the device API (`/v1/console`), which is what the
[Storage Remote](remote-app.md) app does. It does nothing until you pair an
admin device from the local console or with `storage-server pair --console`.
`off` refuses `/v1/console` for every device, and `/v1/info` stops listing
the `console` capability. The local console is not affected either way.

## CORS

Apps are web pages on other origins, so the API answers CORS requests. In
the default `paired` mode an origin is allowed once a device has paired from
it (plus any `--cors-origin`); pairing, sign-in and invite acceptance are
open to any origin because they are protected by one-time secrets. The API
uses bearer tokens, never cookies, so `--cors any` is safe too — `paired`
just narrows the surface further. Private-network preflights (a public app
talking to a LAN address) are answered.
The [web drive](drive.md) at `https://niclaslindstedt.github.io/storage/drive/`
is such an app: in `paired` mode it is allowed once a browser signs in from it.

## Logging

An always-on debug log is appended to `$XDG_STATE_HOME/storage-server/debug.log`
(`STORAGE_LOG_FILE` overrides). `--debug` also prints debug lines on stderr.
Nothing user-authored is ever logged.
