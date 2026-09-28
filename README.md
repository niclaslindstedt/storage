# storage

[![CI](https://github.com/niclaslindstedt/storage/actions/workflows/ci.yml/badge.svg)](https://github.com/niclaslindstedt/storage/actions/workflows/ci.yml)
[![SEO](https://github.com/niclaslindstedt/storage/actions/workflows/seo.yml/badge.svg)](https://github.com/niclaslindstedt/storage/actions/workflows/seo.yml)
[![Pages](https://github.com/niclaslindstedt/storage/actions/workflows/pages.yml/badge.svg)](https://niclaslindstedt.github.io/storage/)
[![Release](https://img.shields.io/github/v/release/niclaslindstedt/storage?sort=semver)](https://github.com/niclaslindstedt/storage/releases)
[![Container](https://img.shields.io/badge/ghcr.io-storage--server-blue)](https://github.com/niclaslindstedt/storage/pkgs/container/storage-server)
[![License: PolyForm Noncommercial](https://img.shields.io/badge/license-PolyForm%20Noncommercial%201.0.0-lightgrey)](LICENSE)

A self-hosted, end-to-end encrypted storage server for local-first apps,
built to hold health data that nobody but its owners can read.

## Why?

- **The host cannot read your data.** Files, records, file names,
  collection names and record keys are encrypted on the device; keys never
  reach the server. A stolen disk or a curious admin sees only ciphertext.
- **Conflicts merge per row, not per file.** Two devices edit the same
  medication offline — one the dose, one the schedule — and both edits
  survive. Tampering, swapping and rollback by the server are detected.
- **Share one namespace, not your account.** Invite a carer to "Mum's
  medication" with a QR code; they see nothing else. Removing them rotates
  the key.
- **Runs at home without a networking degree.** Built-in Let's Encrypt,
  router port mapping (UPnP / NAT-PMP), QR pairing, and a local admin
  console to manage accounts and devices, watch traffic and logs, and fix
  problems.
- **Run it from your phone.** Storage Remote pairs your phone as an _admin
  device_: the whole admin console on the go, plus your own encrypted
  files, shared folder by folder, as an alternative to Dropbox.
- **Let an AI agent use it — safely.** `storage-mcp` is an MCP server
  that gives Claude (or any MCP client) your files, app data and the
  admin console, as an _agent device_ the server holds to the permissions
  you grant. Deleting and sharing need your confirmation; keys and
  credentials are handed out by you, never by the agent.
- **The easiest backend to test against.** Start a real server in-process
  in milliseconds, inject faults, move the clock, snapshot and restore.

## Prerequisites

- **To run it**: Docker, or **Node.js 24+** on Linux or macOS. About 100 MB
  of RAM; disk for your (encrypted) data.
- **To develop**: Node.js 24 (pinned in [`.nvmrc`](.nvmrc)), npm 10+, git,
  and a checkout of
  [oss-framework](https://github.com/niclaslindstedt/oss-framework)
  (`make framework` clones it). Chromium via Playwright for the browser
  tests; optional `shellcheck`, `actionlint`.
- **Apps**: any app built on `@niclaslindstedt/oss-framework` with the
  `storage/selfhosted` backend.

## Install

Container image (GitHub Container Registry, linux/amd64 and linux/arm64):

```sh
docker pull ghcr.io/niclaslindstedt/storage-server:latest
```

npm packages (GitHub Packages) — the server, the test kit, the headless
admin CLI and the MCP server for AI agents:

```sh
echo "@niclaslindstedt:registry=https://npm.pkg.github.com" >> .npmrc
npm install @niclaslindstedt/storage-server @niclaslindstedt/storage-testkit
npm install -g @niclaslindstedt/storage-cli    # the `storage` command
npm install -g @niclaslindstedt/storage-mcp    # the `storage-mcp` MCP server
```

The CLI also ships as an image: `ghcr.io/niclaslindstedt/storage-cli`.

From source:

```sh
git clone https://github.com/niclaslindstedt/storage.git && cd storage
npm ci && make build
node packages/server/dist/cli.js --version
```

## Quick start

```sh
docker run -d --name storage --restart unless-stopped \
  -p 8443:8443 -v storage-data:/data \
  ghcr.io/niclaslindstedt/storage-server:latest
docker logs storage
```

The first start prints a one-time QR code. In the app, choose
**Self-hosted** as the storage backend and scan it: that device becomes the
admin, gets its keys, and shows a **recovery key** once — store it offline.
Add more devices from the app (**Add device** shows a QR the new device
scans) or invite people to a single namespace (**Share**).

Make it reachable from outside your home with a real certificate:

```sh
docker run -d --name storage --network host -v storage-data:/data \
  -e STORAGE_TLS=acme -e STORAGE_DOMAINS=home.example.org \
  -e STORAGE_ACME_EMAIL=you@example.org -e STORAGE_UPNP=1 \
  ghcr.io/niclaslindstedt/storage-server:latest
```

## Usage

### Command line

`storage-server` with no command runs `serve`. Every command has `--help`,
an embedded man page (`storage-server man <command>`) and agent-readable
output (`--help-agent`, `--debug-agent`, `commands --examples`).

| Command       | What it does                                                         |
| ------------- | -------------------------------------------------------------------- |
| `serve`       | Run the storage server (the default command).                        |
| `setup`       | Create the first admin pairing and print its QR code.                |
| `pair`        | Print a one-time QR code that enrols a device.                       |
| `accounts`    | List, create, update and delete accounts.                            |
| `devices`     | List and revoke devices.                                             |
| `namespaces`  | List namespaces (metadata only — contents are end-to-end encrypted). |
| `audit`       | Verify or read the tamper-evident audit log.                         |
| `backup`      | Write a consistent copy of the data directory.                       |
| `cert`        | Show or renew the TLS certificate.                                   |
| `upnp`        | Inspect or change router port forwarding.                            |
| `doctor`      | Check the installation end to end.                                   |
| `admin`       | Print the admin console sign-in link, or rotate its token.           |
| `health`      | Probe the local server (for container and service health checks).    |
| `test-server` | Run an in-memory server in test mode (for end-to-end tests).         |
| `commands`    | List commands in a stable, grep-friendly format.                     |
| `docs`        | Print an embedded documentation topic.                               |
| `man`         | Print an embedded manual page.                                       |

### Admin console

`serve` also starts a web console on `127.0.0.1:8081`, reachable only from
the server itself. Use it to create accounts, show pairing QR codes, revoke
devices, watch traffic, tail logs, verify the audit chain, run the health
checks, back up and download a diagnostics bundle. `GET /metrics` serves
Prometheus metrics.

```sh
storage-server admin                          # prints the sign-in link
ssh -L 8081:127.0.0.1:8081 you@homeserver     # from another computer
```

See [docs/admin-console.md](docs/admin-console.md), including Docker.

### Headless admin CLI (`storage`)

`storage` does everything the console does from a terminal, a script or a
container, in the style of `gh` and `docker`. On the server it works with
no setup (it reads the admin token from the data directory). Elsewhere,
pair it as an admin device, or pass credentials in the environment or a
`.env` file:

```sh
storage status                                   # the Overview page
storage account create grandma --quota 10G --pair
storage device ls --state pending -q | xargs storage device revoke -y
storage logs -f --level warn
storage auth login "$(ssh home storage-server pair --account you --console --json | jq -r .uri)"
docker run --rm --env-file storage.env ghcr.io/niclaslindstedt/storage-cli doctor
```

`STORAGE_TOKEN` (+ `STORAGE_URL`) or `STORAGE_SESSION` (from
`storage auth export`) in the environment or `.env` supply credentials to
scripts and containers. See [docs/cli.md](docs/cli.md) and
[`man/storage/`](man/storage/README.md).

### Storage Remote (your phone)

[`apps/remote`](apps/remote) is the hoster's own app for iOS and Android
(and the web). It gives you every page of the admin console from anywhere,
plus a drive for your own files, encrypted on the phone and shareable
folder by folder. Pair it as an **admin device** from the machine itself:

```sh
storage-server pair --account <you> --console   # or "Pair admin app" in the console
```

Only the local console and the CLI can pair an admin device.
`--remote-console off` disables remote administration entirely. See
[docs/remote-app.md](docs/remote-app.md).

### AI agents (MCP)

[`packages/mcp`](packages/mcp) is `storage-mcp`, a zero-dependency MCP
server. Pair it as an **agent device** — the server enforces the
permissions and apps you grant on every request — then add it to your MCP
client:

```sh
storage-server pair --account <you> --agent --perms data:read --apps drive  # on the server
storage-mcp pair 'oss-storage://pair?…'                                     # where the agent runs
claude mcp add storage -- storage-mcp serve
```

It has tools for everything the admin console and Storage Remote do, and
you decide which the agent sees (`--read-only`, `--disable logs,sharing`,
`config.json`). Destructive and sharing actions ask you to confirm in your
MCP client; pairing, approving devices, invites and recovery keys are not
tools at all — you run them at a terminal (`storage-mcp device approve`,
`storage-mcp invite`, …); file contents are fenced as untrusted data. See
[docs/mcp.md](docs/mcp.md).

### From an app (oss-framework)

```ts
import {
  createSelfHostedClient,
  defaultKeyVault,
} from "@niclaslindstedt/oss-framework/storage";

const client = createSelfHostedClient({
  app: "meds",
  vault: defaultKeyVault("meds"), // non-extractable keys in IndexedDB, or the native keystore
});
await client.pair(scannedQr, { name: "My phone", platform: "ios" });
const recoveryKey = await client.createAccountKeys(); // show once, never stored

const ns = await client.createNamespace({ name: "Mum's medication" });
const meds = ns.recordStore<Medication>("medications"); // row-level sync + merge
meds.set("levaxin", { name: "Levaxin", dose: "50µg", updatedAt: now() });
await meds.sync();

const { payload } = await ns.invite({ role: "editor" }); // render as a QR code
```

Files (`ns.files.write / read / list / history / restore`), a
single-document adapter for apps that store one JSON file, and live change
events are covered in [docs/protocol.md](docs/protocol.md) and the
framework's `src/storage/README.md`.

### In tests

```ts
import { startTestServer } from "@niclaslindstedt/storage-testkit";
import { createTestUser } from "@niclaslindstedt/storage-testkit/client";

const server = await startTestServer(); // in-memory, test mode
const { client } = await createTestUser(server, "mum", { app: "meds" });
await server.faults.status(503, { times: 1 });
await server.clock.advance(24 * 3600_000);
```

For browser tests run `storage-server test-server --secret <s>` and drive it
with `connectTestServer(url, secret)`. See [docs/testing.md](docs/testing.md).

## Configuration

Every setting is a flag, a `STORAGE_*` environment variable, or a key in
`<data-dir>/config.json`; precedence is flags > environment > config.json >
defaults. The ones you are most likely to set:

| Flag               | Environment              | Default                                             | Purpose                                                  |
| ------------------ | ------------------------ | --------------------------------------------------- | -------------------------------------------------------- |
| `--data-dir`       | `STORAGE_DATA_DIR`       | `~/.local/share/storage-server` (`/data` in Docker) | Database, ciphertext blobs, certificates                 |
| `--public-url`     | `STORAGE_PUBLIC_URL`     | —                                                   | URL devices use from outside; goes into QR codes         |
| `--port`           | `STORAGE_PORT`           | `8443`                                              | HTTPS port                                               |
| `--tls`            | `STORAGE_TLS`            | `self-signed`                                       | `acme`, `files`, `self-signed` or `off` (behind a proxy) |
| `--domain`         | `STORAGE_DOMAINS`        | —                                                   | Certificate names for ACME                               |
| `--upnp`           | `STORAGE_UPNP`           | off                                                 | Ask the router to forward the ports                      |
| `--cors`           | `STORAGE_CORS`           | `paired`                                            | Allow browser origins that paired, or `any`              |
| `--admin-port`     | `STORAGE_ADMIN_PORT`     | `8081`                                              | Admin console port (`-1` disables)                       |
| `--admin-host`     | `STORAGE_ADMIN_HOST`     | `127.0.0.1`                                         | Admin console interface; keep it on loopback             |
| `--remote-console` | `STORAGE_REMOTE_CONSOLE` | `on`                                                | Let admin devices (Storage Remote) use the console       |

All settings, with defaults: [docs/configuration.md](docs/configuration.md)
or `storage-server man serve`.

## Examples

[`examples/`](examples) — each runs in CI:

- [node-quickstart](examples/node-quickstart) — pairing, one shared
  encrypted namespace, a row-level merge, and proof the server holds only
  ciphertext.
- [app-testing](examples/app-testing) — an app's tests against a real
  in-memory server: faults, clock, snapshots, rollback detection.
- [home-server](examples/home-server) — Docker Compose for a home server
  with Let's Encrypt and UPnP.

[`apps/reference`](apps/reference) is a complete React app on this backend
with Playwright tests that pair separate browser contexts as devices.
[`apps/remote`](apps/remote) is Storage Remote, with its native wrapper in
[`apps/remote/native`](apps/remote/native).

## Troubleshooting

Start with the admin console's **Troubleshoot** page, or
`storage-server doctor --public-url <url>` in a terminal. Both run the same
checks: data directory, database, audit chain, admin account, disk space,
certificate, router port mapping and NAT type, the public URL and network
exposure. Each problem comes with a fix. The console's **Logs** page tails
the server log live.

| Symptom                                | Fix                                                                                                                                                        |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The app cannot connect from outside    | `curl -v <url>/v1/info` from another network: a timeout means the port is not forwarded (`storage-server upnp status`; CGNAT and double NAT are reported). |
| "Certificate not trusted" in a browser | Browsers need `--tls acme` (or `files`, or a proxy); `self-signed` is for native apps that pin the key from the QR code.                                   |
| "Origin not allowed"                   | Pair from that origin, or add `--cors-origin https://app.example`.                                                                                         |
| 401 after it worked                    | The device was revoked or the account disabled (`storage-server devices list`), or the device clock is far off.                                            |

More in [docs/troubleshooting.md](docs/troubleshooting.md).

## Documentation

Hosted at **[niclaslindstedt.github.io/storage](https://niclaslindstedt.github.io/storage/)**,
and embedded in the CLI (`storage-server docs <topic>`):

- [Getting started](docs/getting-started.md) · [Hosting at home](docs/home-hosting.md) · [Admin console](docs/admin-console.md) · [Headless CLI](docs/cli.md) · [Storage Remote](docs/remote-app.md) · [AI agents (MCP)](docs/mcp.md) · [Configuration](docs/configuration.md)
- [Security model](docs/security.md) · [Sharing a namespace](docs/sharing.md) · [Testing](docs/testing.md)
- [Architecture](docs/architecture.md) · [Protocol (HTTP API v1)](docs/protocol.md) · [Troubleshooting](docs/troubleshooting.md)
- [SPEC.md](SPEC.md) — the full design specification and progress tracker.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Bugs and feature requests go to
[Issues](https://github.com/niclaslindstedt/storage/issues), questions to
[Discussions](https://github.com/niclaslindstedt/storage/discussions), and
security problems privately per [SECURITY.md](SECURITY.md). This repository
follows [OSS_SPEC.md](OSS_SPEC.md).

## License

[PolyForm Noncommercial 1.0.0](LICENSE).
