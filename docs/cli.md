# Headless admin CLI

`storage` administers a storage server from a terminal, a script, a cron
job or a container. It covers every page and action of the
[admin console](admin-console.md): accounts, pairing codes, devices,
namespaces, traffic, metrics, logs, the audit log, health checks, backups,
certificate renewal, port mapping and diagnostics. It works like `gh` and
`docker`: `storage <noun> <verb>`, saved servers ("contexts"), `--json` on
everything, and credentials from the environment or a `.env` file.

It is a separate program from `storage-server`. `storage-server` runs the
server and needs its data directory. `storage` only talks to a running
server's console API, from the same machine or from anywhere else.

```sh
storage status                      # health, TLS, storage, counts, traffic
storage account create grandma --quota 10G --pair
storage device ls --account grandma
storage logs -f --level warn
storage doctor
```

## Install

```sh
echo "@niclaslindstedt:registry=https://npm.pkg.github.com" >> .npmrc
npm install -g @niclaslindstedt/storage-cli
storage --version
```

It needs Node 24 or later and has no dependencies. There is also a
container image, `ghcr.io/niclaslindstedt/storage-cli`
([see below](#docker)).

## Log in

The console API can be reached in two ways, and `storage` supports both.

### With the admin token (on the server's machine)

The console listens on the server's loopback (`127.0.0.1:8081`). It is
unlocked by the admin token in `admin.token` in the data directory.

**On the server itself you do not need to log in.** When no other
credentials are set, `storage` reads `admin.token` from the server's
default data directory (or `STORAGE_DATA_DIR`) and talks to
`127.0.0.1:8081` (or `STORAGE_ADMIN_PORT`):

```sh
sudo -u storage storage status      # as the user that can read the data directory
```

To save it as a context, pass the sign-in link `storage-server admin`
prints, or pipe the token:

```sh
storage auth login "$(storage-server admin)"
cat /var/lib/storage/admin.token | storage auth login --with-token
```

From another computer, open an SSH tunnel first. The console answers only
requests addressed to an IP literal or `localhost`:

```sh
ssh -N -L 8081:127.0.0.1:8081 you@homeserver &
ssh you@homeserver cat /var/lib/storage/admin.token | storage auth login --with-token
```

`storage-server admin --rotate` replaces the token. Every context that
uses it then gets "the admin token was rejected" (exit code 4) until you
log in again.

### As an admin device (from anywhere)

An admin device is a device of an admin account that may use the console
remotely, over the server's HTTPS API at `/v1/console`
([Storage Remote](remote-app.md) is one). Admin devices are paired only at
the machine. On the server run:

```sh
storage-server pair --account niclas --console --no-qr
```

You can also use **Accounts → Pair admin app** in the local console, or
`storage account pair niclas --admin-app` when logged in with the token.
Then, on your laptop:

```sh
storage auth login 'oss-storage://pair?v=1&s=https%3A%2F%2Fhome.example.org&c=…&n=home'
```

The CLI creates a P-256 signing key and registers it by redeeming the
code. It keeps the key in its config file and signs in with it for every
command, caching the 10-minute access token between runs. The device only
signs in: it never receives an account key, so it cannot read any data.
The console lists it as `storage CLI on <hostname>` (platform `cli`,
state "pending" because it has no keys), marked as an admin device.
Changes you make are audited under its device id.

If the server uses a self-signed certificate, the pairing payload carries
its key fingerprint and the CLI pins it. Pass `--fingerprint` (or
`STORAGE_FINGERPRINT`) with `--code` and `--url` if you type the code by
hand.

Pairing an admin device is refused remotely by design:
`storage account pair --admin-app` works only with the admin token.
`storage device remove-admin <id>` takes access away. Demoting or
disabling the account ends it at once. `storage auth logout` revokes the
CLI's own device on the server (`--keep-device` only forgets it locally).

### Contexts

Every login is saved as a context in `config.json` in the config directory
(`$STORAGE_CONFIG_DIR`, default `~/.config/storage`). The file has mode
`0600` and the directory `0700`, because they hold the admin token or the
device key.

```sh
storage context ls                  # * marks the current one
storage context use cabin
storage -c home status              # one command against another server
storage context rename home house
storage auth status                 # are the credentials still accepted?
```

## Credentials from the environment and .env files

For scripts, CI and containers, set credentials in the environment. The
CLI also reads a `.env` file from the working directory, or the files you
name with `--env-file`. Variables already in the environment win over the
file, as in Docker Compose.

| Variable                                   | Meaning                                                                                                |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `STORAGE_TOKEN` / `STORAGE_TOKEN_FILE`     | The admin token, or a file holding it (a Docker secret, or the server's `admin.token`)                 |
| `STORAGE_URL`                              | The console URL for `STORAGE_TOKEN` (default `http://127.0.0.1:8081`), or the server URL for a session |
| `STORAGE_SESSION` / `STORAGE_SESSION_FILE` | An admin-device session from `storage auth export`: URL, device id and key in one string               |
| `STORAGE_CONTEXT`                          | A saved context to use                                                                                 |
| `STORAGE_FINGERPRINT`                      | Pin the server's TLS key (SPKI SHA-256, base64url) instead of trusting the system CAs                  |
| `STORAGE_CONFIG_DIR`                       | Where the contexts live                                                                                |
| `STORAGE_DATA_DIR`, `STORAGE_ADMIN_PORT`   | On the server's machine: where to find `admin.token` and the console port                              |
| `STORAGE_DEBUG`, `NO_COLOR`                | Print each request to stderr; no colours                                                               |

Credentials are resolved in this order, first match wins:

1. `-c/--context`
2. `STORAGE_SESSION`
3. `STORAGE_TOKEN` (with `STORAGE_URL`)
4. `STORAGE_CONTEXT`
5. the saved context whose URL is `STORAGE_URL`
6. the current context
7. `admin.token` in the local data directory

A saved context's credentials are only ever sent to that context's own
URL. `STORAGE_URL` on its own never redirects them elsewhere.

`storage auth export` prints the current credentials as `.env` lines:

```sh
storage auth export > storage.env && chmod 600 storage.env
# STORAGE_SESSION=storage-session-v1.eyJ1cmwiOi…
```

`storage auth token` prints a bearer token for `curl`. With the admin
token that is the token itself. As an admin device it is a fresh
10-minute device token:

```sh
curl -H "Authorization: Bearer $(storage auth token)" https://home.example.org/v1/console/overview
```

Treat both outputs like passwords. A session is a device key: revoke the
device (`storage device revoke <id>`) if one leaks.

## Output

On a terminal, lists are aligned tables with relative times. When stdout
is a pipe, rows are tab-separated with no header and times are ISO 8601,
so `cut`, `awk` and `sort` work. Every list also takes:

- `--json`: the console API's own JSON
- `-q`/`--quiet`: ids (or names) only, one per line
- `--format '{{.name}}\t{{.role}}'`: a template per item. `{{json .}}`
  prints the whole item, and `--format json` prints one JSON object per
  line.

```sh
storage device ls --state pending -q | xargs storage device revoke --yes
storage account ls --json | jq '.[] | select(.usedBytes > 1e9) | .name'
storage audit ls --action device.revoke --format '{{.at}} {{.target}}'
```

Confirmations and progress go to stderr, and data goes to stdout.
Destructive commands (`account rm`, `device revoke`, `device remove-admin`)
ask first. Without a terminal they need `--yes`. `account rm` asks you to
type the account's name, like the console.

Exit codes: `0` success, `1` failure (including `status` with a failing
health verdict, `doctor` with a failed check and `audit verify` with a
broken chain), `2` usage, `4` not logged in or credentials rejected.

## Commands

| Command     | Console page / action                                                                                  |
| ----------- | ------------------------------------------------------------------------------------------------------ |
| `status`    | Overview: health, uptime, URLs, TLS, port mapping, storage, counts, traffic                            |
| `account`   | Accounts: `ls`, `view`, `create [--pair]`, `edit`, `pair [--admin-app \| --agent \| --new]`, `rm`      |
| `device`    | Devices: `ls`, `view`, `revoke`, `remove-admin`, `scope`                                               |
| `namespace` | Namespaces: `ls`, `view` (metadata only)                                                               |
| `traffic`   | Traffic: totals, latency, per-minute and per-route tables                                              |
| `metrics`   | The Prometheus text at `/metrics`                                                                      |
| `logs`      | Logs: recent entries, `-f` to follow, `download` for the debug log file                                |
| `audit`     | Audit: `ls`, `verify`                                                                                  |
| `doctor`    | Troubleshoot: the health checks with a fix for each problem                                            |
| `system`    | Troubleshoot actions: `config`, `housekeeping`, `backup`, `renew-cert`, `refresh-ports`, `diagnostics` |
| `api`       | Any console endpoint, like `gh api`                                                                    |
| `auth`      | `login`, `logout`, `status`, `token`, `export`                                                         |
| `context`   | `ls`, `use`, `show`, `rename`, `rm`                                                                    |

`storage <command> --help` shows the flags. The full reference is in
[`man/storage/`](../man/storage/README.md), and `storage commands` prints
it in a grep-friendly form. `storage --help-agent` describes the tool for
an AI agent.

AI agents run on **agent devices** that the server holds to a scope (see
[AI agents](mcp.md)). Pair one for `storage-mcp`, and narrow it later — a
scope never widens:

```sh
storage account pair niclas --agent --perms data:read --apps drive --no-qr
storage device ls --agent
storage device scope dev_QWdlbnQ --perms data:read --apps drive
```

`storage api` reaches endpoints the other commands do not wrap. The path is
a console path (`/api/accounts`, `accounts`, `/metrics`). As an admin
device it is sent to `/v1/console/<path>`:

```sh
storage api overview | jq .health
storage api accounts -f name=kid -f role=guest -F quotaBytes=1073741824
storage api /api/devices/dev_x -X PATCH -F console=false
```

## Docker

The image `ghcr.io/niclaslindstedt/storage-cli` runs `storage` as a
non-root user in a distroless container. Its working directory is `/work`
and its config directory is `/config`.

```sh
# Credentials from an env file (STORAGE_URL + STORAGE_TOKEN, or STORAGE_SESSION)
docker run --rm --env-file storage.env ghcr.io/niclaslindstedt/storage-cli account ls

# Or log in once and keep the contexts in a named volume
docker run --rm -it -v storage-cli:/config ghcr.io/niclaslindstedt/storage-cli auth login 'oss-storage://pair?…'
docker run --rm -v storage-cli:/config ghcr.io/niclaslindstedt/storage-cli status

# A .env in the current directory, and downloads into it
docker run --rm -v "$PWD:/work" --user "$(id -u):$(id -g)" \
  ghcr.io/niclaslindstedt/storage-cli system diagnostics -o diag.json
```

To reach a console on the Docker host's loopback, use `--network host`.
The console refuses host names such as `host.docker.internal` (its
DNS-rebinding guard).

Next to the server in [`compose.yaml`](../compose.yaml), the `cli` service
reads `admin.token` from the server's data volume (read-only). Nothing
needs to be configured:

```sh
docker compose run --rm cli status
docker compose run --rm cli account create grandma --pair
docker compose run --rm cli logs -f
```

## Troubleshooting

| Symptom                                   | Fix                                                                                                                     |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `cannot reach http://127.0.0.1:8081`      | The server is not running there. The console is loopback-only: run on the server, tunnel, or log in as an admin device. |
| `421` / "DNS-rebinding guard"             | Use an IP literal or `localhost` in the console URL.                                                                    |
| "the admin token was rejected"            | It was rotated: log in again.                                                                                           |
| "rejected this admin device"              | It was revoked, its access removed, or its account disabled or demoted: pair a new one.                                 |
| "does not offer the remote console"       | The server runs with `--remote-console off`: use the admin token on its machine.                                        |
| Certificate errors                        | Pin the self-signed key with `--fingerprint` / `STORAGE_FINGERPRINT`, or trust your CA with `NODE_EXTRA_CA_CERTS`.      |
| "sending the admin token over plain HTTP" | The console URL is not on loopback: the token could be sniffed. Use an SSH tunnel.                                      |

`storage --debug <command>` prints every request and its status.
`storage --debug-agent` prints the config file, the env files it loaded
and which credentials are in use.
