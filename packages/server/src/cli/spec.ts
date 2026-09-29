// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The single source of truth for the CLI surface: every
// command, flag, environment variable, example and exit code. `--help`,
// `--help-agent`, `--debug-agent`, `commands`, the `man/*.md` pages and the
// README's command table are all rendered from these tables.

export type FlagType = "string" | "int" | "bool" | "list";

export type FlagSpec = {
  name: string;
  type: FlagType;
  description: string;
  default?: string;
  env?: string;
  /** A config.json key this flag sets. */
  config?: string;
  value?: string;
};

export type CommandSpec = {
  name: string;
  summary: string;
  usage: string;
  description: string;
  flags: FlagSpec[];
  subcommands?: { name: string; usage: string; summary: string }[];
  examples: { cmd: string; note: string }[];
  exitCodes: { code: number; meaning: string }[];
  seeAlso: string[];
};

export const BIN = "storage-server";

export const EXIT = { ok: 0, failure: 1, usage: 2 } as const;

const STANDARD_EXITS = [
  { code: 0, meaning: "success" },
  { code: 1, meaning: "the operation failed (details on stderr)" },
  { code: 2, meaning: "invalid usage (unknown command, flag or value)" },
];

export const GLOBAL_FLAGS: FlagSpec[] = [
  {
    name: "data-dir",
    type: "string",
    value: "<dir>",
    env: "STORAGE_DATA_DIR",
    config: "dataDir",
    description:
      "Directory holding the database, blobs, certificates and config.json.",
    default: "$XDG_DATA_HOME/storage-server (~/.local/share/storage-server)",
  },
  {
    name: "debug",
    type: "bool",
    env: "STORAGE_DEBUG",
    description: "Also print debug-level log lines to stderr.",
  },
  { name: "help", type: "bool", description: "Show help for the command." },
  { name: "version", type: "bool", description: "Print the version and exit." },
];

/** Flags that configure a server (serve, doctor, cert, upnp, pair, setup). */
export const SERVER_FLAGS: FlagSpec[] = [
  {
    name: "name",
    type: "string",
    value: "<text>",
    env: "STORAGE_NAME",
    config: "name",
    default: "storage",
    description: "Display name shown in pairing QR codes and /v1/info.",
  },
  {
    name: "public-url",
    type: "string",
    value: "<url>",
    env: "STORAGE_PUBLIC_URL",
    config: "publicUrl",
    description:
      "Externally reachable base URL devices use, e.g. https://home.example.org or https://203.0.113.7:443.",
  },
  {
    name: "app-url",
    type: "string",
    value: "<url>",
    env: "STORAGE_APP_URL",
    config: "appUrl",
    description:
      "Wrap QR payloads as <app-url>#oss=… so a phone camera opens the app directly.",
  },
  {
    name: "host",
    type: "string",
    value: "<addr>",
    env: "STORAGE_HOST",
    config: "listen.host",
    default: "0.0.0.0 (127.0.0.1 with --tls off)",
    description: "Address to listen on.",
  },
  {
    name: "port",
    type: "int",
    value: "<port>",
    env: "STORAGE_PORT",
    config: "listen.port",
    default: "8443",
    description: "HTTPS (or plain HTTP with --tls off) port.",
  },
  {
    name: "http-port",
    type: "int",
    value: "<port>",
    env: "STORAGE_HTTP_PORT",
    config: "listen.httpPort",
    description:
      "Plain-HTTP port for ACME http-01 challenges and HTTPS redirects (0 = any free port; unset = disabled).",
  },
  {
    name: "admin-port",
    type: "int",
    value: "<port>",
    env: "STORAGE_ADMIN_PORT",
    config: "listen.adminPort",
    default: "8081",
    description: "Admin console port (-1 disables).",
  },
  {
    name: "admin-host",
    type: "string",
    value: "<addr>",
    env: "STORAGE_ADMIN_HOST",
    config: "listen.adminHost",
    default: "127.0.0.1",
    description:
      "Interface the admin console listens on. Keep it on loopback. Only in a container with published ports use 0.0.0.0, published as -p 127.0.0.1:8081:8081.",
  },
  {
    name: "remote-console",
    type: "string",
    value: "on|off",
    env: "STORAGE_REMOTE_CONSOLE",
    config: "remoteConsole",
    default: "on",
    description:
      "Let admin devices (paired with `pair --console` or from the console) use the admin console remotely at /v1/console. Inert until one is paired.",
  },
  {
    name: "tls",
    type: "string",
    value: "acme|files|self-signed|off",
    env: "STORAGE_TLS",
    config: "tls.mode",
    default: "self-signed",
    description: "How HTTPS certificates are obtained.",
  },
  {
    name: "domain",
    type: "list",
    value: "<name-or-ip>",
    env: "STORAGE_DOMAINS",
    config: "tls.domains",
    description:
      "DNS name or public IP to certify (repeatable; env is comma-separated).",
  },
  {
    name: "acme-email",
    type: "string",
    value: "<email>",
    env: "STORAGE_ACME_EMAIL",
    config: "tls.acmeEmail",
    description: "Contact address for the ACME account.",
  },
  {
    name: "acme-directory",
    type: "string",
    value: "<url>",
    env: "STORAGE_ACME_DIRECTORY",
    config: "tls.acmeDirectory",
    default: "https://acme-v02.api.letsencrypt.org/directory",
    description: "ACME directory URL (use the staging URL while testing).",
  },
  {
    name: "acme-profile",
    type: "string",
    value: "<profile>",
    env: "STORAGE_ACME_PROFILE",
    config: "tls.acmeProfile",
    description:
      "ACME certificate profile; defaults to shortlived when an IP is certified.",
  },
  {
    name: "cert",
    type: "string",
    value: "<file>",
    env: "STORAGE_CERT_FILE",
    config: "tls.certFile",
    description: "PEM certificate chain (with --tls files).",
  },
  {
    name: "key",
    type: "string",
    value: "<file>",
    env: "STORAGE_KEY_FILE",
    config: "tls.keyFile",
    description: "PEM private key (with --tls files).",
  },
  {
    name: "upnp",
    type: "bool",
    env: "STORAGE_UPNP",
    config: "upnp.enabled",
    description:
      "Forward the ports on the home router via UPnP IGD or NAT-PMP.",
  },
  {
    name: "upnp-lease",
    type: "int",
    value: "<seconds>",
    env: "STORAGE_UPNP_LEASE",
    config: "upnp.leaseSeconds",
    default: "3600",
    description: "Port-mapping lease; renewed at half-life.",
  },
  {
    name: "trust-proxy",
    type: "bool",
    env: "STORAGE_TRUST_PROXY",
    config: "trustProxy",
    description:
      "Trust X-Forwarded-For from a reverse proxy (only behind one).",
  },
  {
    name: "cors",
    type: "string",
    value: "paired|any",
    env: "STORAGE_CORS",
    config: "cors.mode",
    default: "paired",
    description:
      "CORS policy: origins learnt at pairing (plus --cors-origin), or any origin.",
  },
  {
    name: "cors-origin",
    type: "list",
    value: "<origin>",
    env: "STORAGE_CORS_ORIGINS",
    config: "cors.origins",
    description:
      "Always-allowed app origin (repeatable; env is comma-separated).",
  },
  {
    name: "default-quota",
    type: "int",
    value: "<bytes>",
    env: "STORAGE_DEFAULT_QUOTA",
    config: "defaultQuotaBytes",
    description:
      "Storage quota for new non-admin accounts (unset = unlimited).",
  },
  {
    name: "history-days",
    type: "int",
    value: "<days>",
    env: "STORAGE_HISTORY_DAYS",
    config: "retention.historyDays",
    default: "30",
    description:
      "Keep earlier versions of a file this many days after they were replaced (0 = none). The console's Settings can change it at runtime.",
  },
  {
    name: "history-versions",
    type: "int",
    value: "<n>",
    env: "STORAGE_HISTORY_VERSIONS",
    config: "retention.historyCount",
    default: "100",
    description: "Keep at most this many versions of each file.",
  },
  {
    name: "trash-days",
    type: "int",
    value: "<days>",
    env: "STORAGE_TRASH_DAYS",
    config: "retention.trashDays",
    default: "30",
    description: "Keep deleted files in the trash this many days.",
  },
];

const pick = (...names: string[]) =>
  SERVER_FLAGS.filter((f) => names.includes(f.name));

export const COMMANDS: CommandSpec[] = [
  {
    name: "serve",
    summary: "Run the storage server (the default command).",
    usage: `${BIN} serve [--data-dir <dir>] [--tls <mode>] [--domain <name>]... [--upnp] [flags]`,
    description:
      "Starts the HTTPS API, the admin console (a local web UI to administer, monitor, read logs and troubleshoot; its sign-in link is printed to stderr) and background housekeeping. On first start, when no account exists, it prints a one-time QR code that enrols the first device as the admin.",
    flags: SERVER_FLAGS,
    examples: [
      {
        cmd: `${BIN} serve --data-dir ~/storage`,
        note: "self-signed HTTPS on :8443 (native apps pin it via the QR code)",
      },
      {
        cmd: `${BIN} serve --tls acme --domain home.example.org --http-port 80 --port 443 --upnp`,
        note: "home server with a Let's Encrypt certificate and automatic port forwarding",
      },
      {
        cmd: `${BIN} serve --tls acme --domain 203.0.113.7 --port 443 --upnp`,
        note: "no domain: a short-lived IP certificate validated with tls-alpn-01",
      },
      {
        cmd: `${BIN} serve --tls off --host 127.0.0.1 --port 8080 --trust-proxy --public-url https://storage.example.org`,
        note: "behind Caddy, nginx or a tunnel",
      },
    ],
    exitCodes: STANDARD_EXITS,
    seeAlso: ["setup", "pair", "admin", "doctor"],
  },
  {
    name: "setup",
    summary: "Create the first admin pairing and print its QR code.",
    usage: `${BIN} setup [--account <name>] [--ttl <seconds>] [--public-url <url>]`,
    description:
      "Mints a one-time code that creates the admin account when a device redeems it. Refuses when an admin already exists.",
    flags: [
      {
        name: "account",
        type: "string",
        value: "<name>",
        default: "admin",
        description: "Name of the admin account to create.",
      },
      {
        name: "ttl",
        type: "int",
        value: "<seconds>",
        default: "600",
        description: "How long the code stays valid.",
      },
      {
        name: "no-qr",
        type: "bool",
        description: "Print only the payload, no QR code.",
      },
      ...pick("public-url", "app-url", "name", "port", "tls"),
    ],
    examples: [
      {
        cmd: `${BIN} setup --account niclas --public-url https://home.example.org`,
        note: "first-time setup",
      },
    ],
    exitCodes: STANDARD_EXITS,
    seeAlso: ["pair", "serve"],
  },
  {
    name: "pair",
    summary: "Print a one-time QR code that enrols a device.",
    usage: `${BIN} pair (--account <name> | --new <name> [--role <role>]) [--console] [--agent [--perms <list>] [--apps <list>]] [--ttl <seconds>] [--json]`,
    description:
      "Pairs a device to an existing account, or creates a new account on redemption. The code only signs the device in: encryption keys come from the recovery key or from another device, never from the server. With --console the device becomes an admin device that may use the admin console remotely (the remote app); only an admin account can have one, and only this command or the local console can pair one. With --agent the device becomes an agent device (an AI agent's MCP server, a script): the server holds it to the permissions in --perms and the apps in --apps on every request, and its scope can later be narrowed but never widened.",
    flags: [
      {
        name: "account",
        type: "string",
        value: "<name>",
        description: "Existing account to add a device to.",
      },
      {
        name: "new",
        type: "string",
        value: "<name>",
        description: "Create this account when the code is redeemed.",
      },
      {
        name: "role",
        type: "string",
        value: "admin|member|guest",
        default: "member",
        description: "Role of the new account.",
      },
      {
        name: "ttl",
        type: "int",
        value: "<seconds>",
        default: "600",
        description: "How long the code stays valid.",
      },
      {
        name: "no-qr",
        type: "bool",
        description: "Print only the payload, no QR code.",
      },
      {
        name: "json",
        type: "bool",
        description: "Print {code, uri, expiresAt} as JSON.",
      },
      {
        name: "console",
        type: "bool",
        description:
          "Pair an admin device: it may use the admin console remotely (admin accounts only).",
      },
      {
        name: "agent",
        type: "bool",
        description:
          "Pair an agent device, held to --perms and --apps by the server (see `docs mcp`).",
      },
      {
        name: "perms",
        type: "string",
        value: "<list>",
        default: "data:read (+ console:read with --console)",
        description:
          "Comma-separated agent permissions: data:read, data:write, sharing, devices, console:read, console:write.",
      },
      {
        name: "apps",
        type: "string",
        value: "<list>",
        description:
          "Comma-separated app ids whose namespaces the agent may see (default: all), e.g. drive,notes.",
      },
      ...pick("public-url", "app-url", "name", "port", "tls"),
    ],
    examples: [
      {
        cmd: `${BIN} pair --account niclas`,
        note: "add a phone to an existing account",
      },
      {
        cmd: `${BIN} pair --account niclas --console`,
        note: "pair the remote admin app on your phone",
      },
      {
        cmd: `${BIN} pair --account niclas --agent --perms data:read --apps drive`,
        note: "pair an AI agent (storage-mcp) that may only read the drive",
      },
      {
        cmd: `${BIN} pair --new grandma --role member --ttl 3600`,
        note: "a new family member",
      },
      {
        cmd: `${BIN} pair --account niclas --json | jq -r .uri`,
        note: "script it",
      },
    ],
    exitCodes: STANDARD_EXITS,
    seeAlso: ["setup", "accounts", "devices"],
  },
  {
    name: "accounts",
    summary: "List, create, update and delete accounts.",
    usage: `${BIN} accounts <list|create|update|delete> [<name>] [flags]`,
    description:
      "Manages who can use the server. Deleting an account deletes every namespace it owns, for all members.",
    subcommands: [
      {
        name: "list",
        usage: `${BIN} accounts list [--json]`,
        summary: "List accounts with role, usage and quota.",
      },
      {
        name: "create",
        usage: `${BIN} accounts create <name> [--role <role>] [--quota <bytes>]`,
        summary: "Create an account (pair a device to it with `pair`).",
      },
      {
        name: "update",
        usage: `${BIN} accounts update <name> [--role <role>] [--quota <bytes>|--unlimited] [--rename <new>] [--disable|--enable]`,
        summary: "Change role, quota, name or disabled state.",
      },
      {
        name: "delete",
        usage: `${BIN} accounts delete <name> --yes`,
        summary: "Delete an account and the namespaces it owns.",
      },
    ],
    flags: [
      {
        name: "role",
        type: "string",
        value: "admin|member|guest",
        description: "Account role.",
      },
      {
        name: "quota",
        type: "int",
        value: "<bytes>",
        description: "Storage quota in bytes.",
      },
      { name: "unlimited", type: "bool", description: "Remove the quota." },
      {
        name: "rename",
        type: "string",
        value: "<name>",
        description: "New account name.",
      },
      {
        name: "disable",
        type: "bool",
        description: "Disable the account (its devices stop working).",
      },
      {
        name: "enable",
        type: "bool",
        description: "Re-enable a disabled account.",
      },
      {
        name: "yes",
        type: "bool",
        description: "Confirm a destructive action.",
      },
      { name: "json", type: "bool", description: "Machine-readable output." },
    ],
    examples: [
      { cmd: `${BIN} accounts list`, note: "who is on this server" },
      {
        cmd: `${BIN} accounts create kid --role member --quota 1073741824`,
        note: "1 GiB quota",
      },
      {
        cmd: `${BIN} accounts update kid --disable`,
        note: "lock an account out",
      },
    ],
    exitCodes: STANDARD_EXITS,
    seeAlso: ["pair", "devices"],
  },
  {
    name: "devices",
    summary: "List and revoke devices.",
    usage: `${BIN} devices <list|revoke> [flags]`,
    description:
      "Revoking a device ends its sessions and deletes its copy of the account key at once. Rotate shared namespace keys from an app afterwards if the device was lost.",
    subcommands: [
      {
        name: "list",
        usage: `${BIN} devices list [--account <name>] [--json]`,
        summary: "List devices (all, or one account's).",
      },
      {
        name: "revoke",
        usage: `${BIN} devices revoke <device-id>`,
        summary: "Revoke a device.",
      },
    ],
    flags: [
      {
        name: "account",
        type: "string",
        value: "<name>",
        description: "Only this account's devices.",
      },
      { name: "json", type: "bool", description: "Machine-readable output." },
    ],
    examples: [
      { cmd: `${BIN} devices list --account niclas`, note: "" },
      {
        cmd: `${BIN} devices revoke dev_Q2hhbGxlbmdlLWNvZGUtM`,
        note: "a lost phone",
      },
    ],
    exitCodes: STANDARD_EXITS,
    seeAlso: ["accounts", "audit"],
  },
  {
    name: "namespaces",
    summary:
      "List namespaces (metadata only — contents are end-to-end encrypted).",
    usage: `${BIN} namespaces list [--json]`,
    description:
      "Shows id, app, owner, member count, bytes used and change sequence. Names are encrypted and cannot be shown.",
    subcommands: [
      {
        name: "list",
        usage: `${BIN} namespaces list [--json]`,
        summary: "List namespaces.",
      },
    ],
    flags: [
      { name: "json", type: "bool", description: "Machine-readable output." },
    ],
    examples: [
      {
        cmd: `${BIN} namespaces list --json | jq '.[] | select(.app=="meds")'`,
        note: "",
      },
    ],
    exitCodes: STANDARD_EXITS,
    seeAlso: ["accounts"],
  },
  {
    name: "audit",
    summary: "Verify or read the tamper-evident audit log.",
    usage: `${BIN} audit <verify|tail> [--limit <n>] [--json]`,
    description:
      "Every security-relevant event (pairing, auth failures, revocations, sharing, key rotation, deletions) is hash-chained; `verify` recomputes the chain and reports the first broken entry.",
    subcommands: [
      {
        name: "verify",
        usage: `${BIN} audit verify`,
        summary: "Recompute the hash chain; exit 1 if it is broken.",
      },
      {
        name: "tail",
        usage: `${BIN} audit tail [--limit <n>] [--json]`,
        summary: "Show the newest entries.",
      },
    ],
    flags: [
      {
        name: "limit",
        type: "int",
        value: "<n>",
        default: "50",
        description: "Entries to show.",
      },
      { name: "json", type: "bool", description: "Machine-readable output." },
    ],
    examples: [
      { cmd: `${BIN} audit verify`, note: "" },
      { cmd: `${BIN} audit tail --limit 20`, note: "" },
    ],
    exitCodes: STANDARD_EXITS,
    seeAlso: ["doctor"],
  },
  {
    name: "backup",
    summary: "Write a consistent copy of the data directory.",
    usage: `${BIN} backup --out <dir>`,
    description:
      "Copies the database (via SQLite VACUUM INTO, safe while serving), all blobs and certificates. Everything user-authored in it is ciphertext. Restore by stopping the server and using the backup as --data-dir.",
    flags: [
      {
        name: "out",
        type: "string",
        value: "<dir>",
        description: "Empty or new directory to write the backup to.",
      },
    ],
    examples: [
      {
        cmd: `${BIN} backup --out /mnt/usb/storage-$(date +%F)`,
        note: "nightly from cron",
      },
    ],
    exitCodes: STANDARD_EXITS,
    seeAlso: ["doctor"],
  },
  {
    name: "cert",
    summary: "Show or renew the TLS certificate.",
    usage: `${BIN} cert <status|renew> [server flags]`,
    description:
      "`status` prints the mode, identifiers, key fingerprint and expiry. `renew` forces an ACME renewal (the running server renews automatically).",
    subcommands: [
      {
        name: "status",
        usage: `${BIN} cert status`,
        summary: "Show the current certificate.",
      },
      {
        name: "renew",
        usage: `${BIN} cert renew --tls acme --domain <name> --http-port 80`,
        summary: "Obtain a new ACME certificate now.",
      },
    ],
    flags: pick(
      "tls",
      "domain",
      "acme-email",
      "acme-directory",
      "acme-profile",
      "cert",
      "key",
      "http-port",
    ),
    examples: [{ cmd: `${BIN} cert status`, note: "" }],
    exitCodes: STANDARD_EXITS,
    seeAlso: ["serve", "doctor"],
  },
  {
    name: "upnp",
    summary: "Inspect or change router port forwarding.",
    usage: `${BIN} upnp <status|map|unmap> [--port <n>] [--external <n>]`,
    description:
      "Talks to the router via UPnP IGD, falling back to NAT-PMP. `status` also reports whether the router's WAN address is behind carrier-grade or double NAT.",
    subcommands: [
      {
        name: "status",
        usage: `${BIN} upnp status`,
        summary: "Find the gateway and its external address.",
      },
      {
        name: "map",
        usage: `${BIN} upnp map --port 8443 --external 443`,
        summary:
          "Add a mapping (lease renewed only while `serve --upnp` runs).",
      },
      {
        name: "unmap",
        usage: `${BIN} upnp unmap --external 443`,
        summary: "Remove a mapping.",
      },
    ],
    flags: [
      {
        name: "port",
        type: "int",
        value: "<port>",
        default: "8443",
        description: "Internal port.",
      },
      {
        name: "external",
        type: "int",
        value: "<port>",
        default: "443",
        description: "External port on the router.",
      },
    ],
    examples: [{ cmd: `${BIN} upnp status`, note: "" }],
    exitCodes: STANDARD_EXITS,
    seeAlso: ["serve", "doctor"],
  },
  {
    name: "doctor",
    summary: "Check the installation end to end.",
    usage: `${BIN} doctor [server flags]`,
    description:
      "Checks the data directory (writable, private), database integrity, the audit chain, that an admin exists, free disk space, the certificate, router mapping and NAT type, that the public URL answers, and network exposure — the same checks as the admin console's Troubleshoot page. Prints a fix for each problem; exit code 1 when any check fails.",
    flags: SERVER_FLAGS,
    examples: [
      { cmd: `${BIN} doctor --public-url https://home.example.org`, note: "" },
    ],
    exitCodes: STANDARD_EXITS,
    seeAlso: ["admin", "cert", "upnp", "audit"],
  },
  {
    name: "admin",
    summary: "Print the admin console sign-in link, or rotate its token.",
    usage: `${BIN} admin [--rotate] [--json]`,
    description:
      "The admin console is a local web UI that serve starts on 127.0.0.1:8081 (see --admin-host and --admin-port). It is unlocked by a token kept in admin.token in the data directory; this command prints a sign-in link carrying it. --rotate replaces the token, which signs out every open console session immediately (no restart needed).",
    flags: [
      {
        name: "rotate",
        type: "bool",
        description: "Replace the admin token and end every console session.",
      },
      { name: "json", type: "bool", description: "Print JSON." },
      ...pick("admin-port", "admin-host"),
    ],
    examples: [
      {
        cmd: `${BIN} admin`,
        note: "open the printed link in a browser on this machine",
      },
      {
        cmd: `ssh -L 8081:127.0.0.1:8081 pi@homeserver`,
        note: "reach a home server's console from your laptop",
      },
      { cmd: `${BIN} admin --rotate`, note: "after sharing a link by mistake" },
      {
        cmd: `docker exec storage /nodejs/bin/node /app/dist/cli.js admin`,
        note: "in the container",
      },
    ],
    exitCodes: STANDARD_EXITS,
    seeAlso: ["serve", "doctor"],
  },
  {
    name: "health",
    summary:
      "Probe the local server (for container and service health checks).",
    usage: `${BIN} health [--port <n>] [--tls <mode>]`,
    description:
      "Requests /v1/info on 127.0.0.1 and exits 0 when the server answers. Liveness only: it sends no credentials, so it skips certificate verification.",
    flags: pick("port", "tls"),
    examples: [
      { cmd: `${BIN} health --port 8443`, note: "Docker HEALTHCHECK" },
    ],
    exitCodes: [
      { code: 0, meaning: "the server answered" },
      { code: 1, meaning: "no answer or an error status" },
      { code: 2, meaning: "invalid usage" },
    ],
    seeAlso: ["doctor", "serve"],
  },
  {
    name: "test-server",
    summary: "Run an in-memory server in test mode (for end-to-end tests).",
    usage: `${BIN} test-server [--port <n>] [--host <addr>] [--secret <s>]`,
    description:
      "Starts a throwaway plain-HTTP server with /__test/* controls (reset, snapshot, restore, faults, clock, accounts) and prints one JSON line {url, secret} on stdout. Never holds real data.",
    flags: [
      {
        name: "port",
        type: "int",
        value: "<port>",
        default: "0",
        description: "Port (0 = any free port).",
      },
      {
        name: "host",
        type: "string",
        value: "<addr>",
        default: "127.0.0.1",
        description: "Address to listen on.",
      },
      {
        name: "secret",
        type: "string",
        value: "<secret>",
        description: "Test secret (random when omitted).",
      },
      {
        name: "cors",
        type: "string",
        value: "paired|any",
        default: "any",
        description: "CORS policy.",
      },
    ],
    examples: [
      {
        cmd: `${BIN} test-server --port 4010 --secret dev`,
        note: "for a Playwright webServer",
      },
    ],
    exitCodes: STANDARD_EXITS,
    seeAlso: ["serve"],
  },
  {
    name: "commands",
    summary: "List commands in a stable, grep-friendly format.",
    usage: `${BIN} commands [<name>] [--examples]`,
    description:
      "With no name, one line per command. With a name, that command's full flag and exit-code specification. --examples adds example invocations.",
    flags: [
      {
        name: "examples",
        type: "bool",
        description: "Show example invocations.",
      },
    ],
    examples: [
      { cmd: `${BIN} commands`, note: "" },
      { cmd: `${BIN} commands pair`, note: "" },
      { cmd: `${BIN} commands --examples | grep -A3 upnp`, note: "" },
    ],
    exitCodes: STANDARD_EXITS,
    seeAlso: ["man", "docs"],
  },
  {
    name: "docs",
    summary: "Print an embedded documentation topic.",
    usage: `${BIN} docs [<topic>]`,
    description:
      "With no topic, lists the topics. Works offline: the docs are compiled into the binary.",
    flags: [],
    examples: [
      { cmd: `${BIN} docs`, note: "" },
      { cmd: `${BIN} docs home-hosting`, note: "" },
    ],
    exitCodes: STANDARD_EXITS,
    seeAlso: ["man", "commands"],
  },
  {
    name: "man",
    summary: "Print an embedded manual page.",
    usage: `${BIN} man [<command>]`,
    description: "With no command, lists the manual pages.",
    flags: [],
    examples: [{ cmd: `${BIN} man serve`, note: "" }],
    exitCodes: STANDARD_EXITS,
    seeAlso: ["docs", "commands"],
  },
];

export function findCommand(name: string): CommandSpec | undefined {
  return COMMANDS.find((c) => c.name === name);
}

/** Every environment variable the CLI reads. */
export const ENV_VARS: { name: string; description: string }[] = [
  ...[...GLOBAL_FLAGS, ...SERVER_FLAGS]
    .filter((f) => f.env)
    .map((f) => ({ name: f.env!, description: f.description })),
  {
    name: "STORAGE_LOG_FILE",
    description: "Path of the always-on debug log file.",
  },
  {
    name: "XDG_DATA_HOME",
    description: "Base for the default data directory.",
  },
  {
    name: "XDG_STATE_HOME",
    description: "Base for the default log directory.",
  },
];
