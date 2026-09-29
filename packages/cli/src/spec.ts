// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The single source of truth for the `storage` CLI surface: every command,
// subcommand, flag, environment variable, example and exit code. --help,
// `commands`, --help-agent and the man/storage/*.md pages are rendered from
// these tables, and the parser reads its flags from them.
//
// guidelines:allow-large-file: split when next touched; known deviation by owner decision

export type FlagType = "string" | "int" | "bool" | "list";

export type FlagSpec = {
  name: string;
  /** One-letter alias, e.g. "q" for -q. */
  short?: string;
  type: FlagType;
  description: string;
  default?: string;
  env?: string;
  value?: string;
};

export type SubcommandSpec = {
  name: string;
  aliases?: string[];
  usage: string;
  summary: string;
  flags: FlagSpec[];
  /** Positional arguments: min required, max accepted (Infinity = any). */
  args?: [number, number];
};

export type CommandSpec = {
  name: string;
  aliases?: string[];
  group: "core" | "auth" | "admin" | "monitor" | "meta";
  summary: string;
  usage: string;
  description: string;
  /** Flags of a command without subcommands. */
  flags?: FlagSpec[];
  args?: [number, number];
  subcommands?: SubcommandSpec[];
  /** The subcommand run when none is named (else help is shown). */
  defaultSubcommand?: string;
  examples: { cmd: string; note: string }[];
  exitCodes: { code: number; meaning: string }[];
  seeAlso: string[];
};

export const BIN = "storage";

export const EXIT = { ok: 0, failure: 1, usage: 2, auth: 4 } as const;

const STANDARD_EXITS = [
  { code: 0, meaning: "success" },
  { code: 1, meaning: "the request failed (details on stderr)" },
  { code: 2, meaning: "invalid usage (unknown command, flag or value)" },
  { code: 4, meaning: "not logged in, or the credentials were rejected" },
];

/** The console listener's default address (`storage-server serve`). */
export const DEFAULT_CONSOLE_URL = "http://127.0.0.1:8081";

export const GLOBAL_FLAGS: FlagSpec[] = [
  {
    name: "context",
    short: "c",
    type: "string",
    value: "<name>",
    env: "STORAGE_CONTEXT",
    description:
      "Saved server to talk to (see `storage context ls`); overrides the current one.",
  },
  {
    name: "env-file",
    type: "list",
    value: "<file>",
    default: ".env (when present)",
    description:
      "Read variables from this file (repeatable). The environment wins over the file.",
  },
  {
    name: "no-color",
    type: "bool",
    env: "NO_COLOR",
    description: "Plain output without ANSI colours.",
  },
  {
    name: "debug",
    type: "bool",
    env: "STORAGE_DEBUG",
    description: "Print each HTTP request and its status to stderr.",
  },
  {
    name: "help",
    short: "h",
    type: "bool",
    description: "Show help for the command.",
  },
];

// ---------------------------------------------------------------- shared flags

const JSON_FLAG: FlagSpec = {
  name: "json",
  type: "bool",
  description: "Print the console API's JSON instead of a table.",
};
const QUIET_FLAG: FlagSpec = {
  name: "quiet",
  short: "q",
  type: "bool",
  description: "Print only ids (or names), one per line — for piping.",
};
const FORMAT_FLAG: FlagSpec = {
  name: "format",
  type: "string",
  value: "<template>",
  description:
    "Print each item with a template: {{.field}} placeholders, {{json .}} for the whole item, \\t and \\n escapes.",
};
const LIST_OUTPUT = [JSON_FLAG, QUIET_FLAG, FORMAT_FLAG];
const YES_FLAG: FlagSpec = {
  name: "yes",
  short: "y",
  type: "bool",
  description: "Do not ask for confirmation.",
};
const OUTPUT_FILE: FlagSpec = {
  name: "output",
  short: "o",
  type: "string",
  value: "<file>",
  description: "Write to this file ('-' for stdout).",
};
const ROLE_FLAG: FlagSpec = {
  name: "role",
  type: "string",
  value: "admin|member|guest",
  description: "Account role.",
};
const NO_QR: FlagSpec = {
  name: "no-qr",
  type: "bool",
  description: "Print only the pairing payload, no QR code.",
};

// ---------------------------------------------------------------- commands

export const COMMANDS: CommandSpec[] = [
  {
    name: "auth",
    group: "auth",
    summary: "Log in to a storage server, show and export credentials.",
    usage: `${BIN} auth <login|logout|status|token|export> [flags]`,
    description:
      "Two ways in. On the server's machine (or through an SSH tunnel), log in to the admin console listener with its admin token: paste the link `storage-server admin` prints, or pipe the token with --with-token. From anywhere else, log in as an admin device: run `storage-server pair --account <admin> --console` (or use \"Pair admin app\" in the console) and pass the printed oss-storage:// payload; the CLI creates a device key, keeps it in its config file (mode 0600), and signs in with it over the server's HTTPS API. Each login is saved as a context. For scripts and containers, `auth export` prints the credentials as STORAGE_* lines for a .env file.",
    subcommands: [
      {
        name: "login",
        usage: `${BIN} auth login [<sign-in-link|pairing-payload>] [--url <url>] [--with-token | --code <code>] [--name <device-name>] [-c <context>]`,
        summary:
          "Save a server: with the admin token (console link) or by pairing an admin device.",
        args: [0, 1],
        flags: [
          {
            name: "url",
            type: "string",
            value: "<url>",
            description:
              "Console URL for --with-token (default http://127.0.0.1:8081), or the server URL for --code.",
          },
          {
            name: "with-token",
            type: "bool",
            description: "Read the admin token from standard input.",
          },
          {
            name: "code",
            type: "string",
            value: "<code>",
            description: "An admin-device pairing code (with --url).",
          },
          {
            name: "fingerprint",
            type: "string",
            value: "<sha256>",
            env: "STORAGE_FINGERPRINT",
            description:
              "Pin the server's TLS key (SPKI SHA-256, base64url) — for a self-signed certificate. Pairing payloads carry it.",
          },
          {
            name: "name",
            type: "string",
            value: "<device-name>",
            default: "storage CLI on <hostname>",
            description: "Name of the admin device the server lists.",
          },
        ],
      },
      {
        name: "logout",
        usage: `${BIN} auth logout [-c <context>] [--keep-device]`,
        summary:
          "Forget a context; an admin device is also revoked on the server.",
        args: [0, 0],
        flags: [
          {
            name: "keep-device",
            type: "bool",
            description:
              "Do not revoke the admin device (its exported session keeps working).",
          },
        ],
      },
      {
        name: "status",
        usage: `${BIN} auth status [--json]`,
        summary:
          "Show where the credentials come from and whether they are accepted.",
        args: [0, 0],
        flags: [JSON_FLAG],
      },
      {
        name: "token",
        usage: `${BIN} auth token`,
        summary:
          "Print a bearer token for curl: the admin token, or a 10-minute admin-device token.",
        args: [0, 0],
        flags: [],
      },
      {
        name: "export",
        usage: `${BIN} auth export`,
        summary:
          "Print the current credentials as .env lines (STORAGE_URL, STORAGE_TOKEN or STORAGE_SESSION).",
        args: [0, 0],
        flags: [],
      },
    ],
    examples: [
      {
        cmd: `${BIN} auth login "$(storage-server admin)"`,
        note: "on the server: log in with the console's sign-in link",
      },
      {
        cmd: `ssh pi@home cat /var/lib/storage/admin.token | ${BIN} auth login --with-token`,
        note: "through an SSH tunnel to 127.0.0.1:8081",
      },
      {
        cmd: `${BIN} auth login 'oss-storage://pair?v=1&s=https%3A%2F%2Fhome.example.org&c=…'`,
        note: "anywhere: pair the CLI as an admin device",
      },
      {
        cmd: `${BIN} auth export >> .env && chmod 600 .env`,
        note: "hand the session to a script or a container",
      },
    ],
    exitCodes: STANDARD_EXITS,
    seeAlso: ["context", "status"],
  },
  {
    name: "context",
    group: "auth",
    summary: "List, switch, rename and remove saved servers.",
    usage: `${BIN} context <ls|use|show|rename|rm> [<name>]`,
    description:
      "Every `auth login` saves a context — a server URL plus credentials — in config.json in the config directory ($STORAGE_CONFIG_DIR, default ~/.config/storage). One context is current; -c/--context or STORAGE_CONTEXT picks another for one command.",
    subcommands: [
      {
        name: "ls",
        aliases: ["list"],
        usage: `${BIN} context ls [--json]`,
        summary: "List contexts; the current one is marked with *.",
        args: [0, 0],
        flags: [JSON_FLAG, QUIET_FLAG],
      },
      {
        name: "use",
        usage: `${BIN} context use <name>`,
        summary: "Make a context the current one.",
        args: [1, 1],
        flags: [],
      },
      {
        name: "show",
        usage: `${BIN} context show`,
        summary: "Print the name of the context commands will use.",
        args: [0, 0],
        flags: [],
      },
      {
        name: "rename",
        usage: `${BIN} context rename <old> <new>`,
        summary: "Rename a context.",
        args: [2, 2],
        flags: [],
      },
      {
        name: "rm",
        aliases: ["remove"],
        usage: `${BIN} context rm <name>...`,
        summary:
          "Forget contexts locally (use `auth logout` to also revoke an admin device).",
        args: [1, Infinity],
        flags: [],
      },
    ],
    examples: [
      { cmd: `${BIN} context ls`, note: "" },
      { cmd: `${BIN} context use home`, note: "" },
      {
        cmd: `${BIN} -c cabin status`,
        note: "one command against another server",
      },
    ],
    exitCodes: STANDARD_EXITS,
    seeAlso: ["auth"],
  },
  {
    name: "status",
    aliases: ["overview", "info"],
    group: "core",
    summary:
      "Health, uptime, URLs, TLS, port mapping, storage, counts and traffic at a glance.",
    usage: `${BIN} status [--json]`,
    description:
      "The console's Overview page: the health verdict and its problems, version and uptime, the public URL, the certificate, the router mapping, disk and database use, account/device/namespace counts, traffic totals and latency, log problem counts and the audit chain. Exits 1 when the health verdict is fail.",
    flags: [JSON_FLAG],
    args: [0, 0],
    examples: [
      { cmd: `${BIN} status`, note: "" },
      {
        cmd: `${BIN} status --json | jq .tls.daysLeft`,
        note: "days until the certificate expires",
      },
    ],
    exitCodes: [
      { code: 0, meaning: "the server is healthy (or only warns)" },
      { code: 1, meaning: "a health check fails, or the request failed" },
      { code: 2, meaning: "invalid usage" },
      { code: 4, meaning: "not logged in, or the credentials were rejected" },
    ],
    seeAlso: ["doctor", "traffic"],
  },
  {
    name: "account",
    aliases: ["accounts"],
    group: "admin",
    summary: "List, create, edit, pair and delete accounts.",
    usage: `${BIN} account <ls|view|create|edit|pair|rm> [<name>] [flags]`,
    description:
      "The console's Accounts page. Accounts are named by name or id. Deleting an account deletes every namespace it owns, for all members, so it asks you to type the account's name (or pass --yes). Quotas take bytes or a size with a unit: 500M, 10G, 1T (powers of 1024).",
    subcommands: [
      {
        name: "ls",
        aliases: ["list"],
        usage: `${BIN} account ls [--role <role>] [--json | -q | --format <t>]`,
        summary: "List accounts with role, usage, quota, devices and state.",
        args: [0, 0],
        flags: [
          { ...ROLE_FLAG, description: "Only this role." },
          ...LIST_OUTPUT,
        ],
      },
      {
        name: "view",
        usage: `${BIN} account view <name> [--json]`,
        summary: "Show one account, with its devices and namespaces.",
        args: [1, 1],
        flags: [JSON_FLAG],
      },
      {
        name: "create",
        usage: `${BIN} account create <name> [--role <role>] [--quota <size>] [--pair]`,
        summary:
          "Create an account; --pair also prints a QR code for its first device.",
        args: [1, 1],
        flags: [
          { ...ROLE_FLAG, default: "member" },
          {
            name: "quota",
            type: "string",
            value: "<size>",
            description: "Storage quota (e.g. 10G).",
          },
          {
            name: "pair",
            type: "bool",
            description: "Also mint a pairing for the account's first device.",
          },
          NO_QR,
          JSON_FLAG,
        ],
      },
      {
        name: "edit",
        usage: `${BIN} account edit <name> [--name <new>] [--role <role>] [--quota <size> | --unlimited] [--disable | --enable]`,
        summary: "Rename, change role or quota, disable or enable.",
        args: [1, 1],
        flags: [
          {
            name: "name",
            type: "string",
            value: "<new-name>",
            description: "New account name.",
          },
          ROLE_FLAG,
          {
            name: "quota",
            type: "string",
            value: "<size>",
            description: "New storage quota (e.g. 10G).",
          },
          { name: "unlimited", type: "bool", description: "Remove the quota." },
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
          JSON_FLAG,
        ],
      },
      {
        name: "pair",
        usage: `${BIN} account pair <name> [--admin-app] [--agent [--perms <list>] [--apps <list>]] | --new <name> [--role <role>]  [--no-qr] [--json]`,
        summary:
          "Print a one-time QR code that pairs a device to an account (or creates the account).",
        args: [0, 1],
        flags: [
          {
            name: "new",
            type: "string",
            value: "<name>",
            description: "Create this account when the code is redeemed.",
          },
          {
            ...ROLE_FLAG,
            default: "member",
            description: "Role of the --new account.",
          },
          {
            name: "admin-app",
            type: "bool",
            description:
              "Pair an admin device (Storage Remote, or another `storage` CLI). Admin accounts only, and only when logged in with the admin token: remote access is granted at the machine.",
          },
          {
            name: "agent",
            type: "bool",
            description:
              "Pair an agent device (an AI agent's `storage-mcp`, a script), held by the server to --perms and --apps on every request.",
          },
          {
            name: "perms",
            type: "string",
            value: "<list>",
            description:
              "Comma-separated agent permissions: data:read (the default), data:write, sharing, devices; with --admin-app also console:read, console:write.",
          },
          {
            name: "apps",
            type: "string",
            value: "<list>",
            description:
              "Comma-separated app ids the agent may see, e.g. drive,notes (default: all).",
          },
          NO_QR,
          JSON_FLAG,
        ],
      },
      {
        name: "rm",
        aliases: ["delete"],
        usage: `${BIN} account rm <name> [--yes]`,
        summary: "Delete an account and every namespace it owns.",
        args: [1, 1],
        flags: [YES_FLAG],
      },
    ],
    examples: [
      { cmd: `${BIN} account ls`, note: "who is on this server" },
      {
        cmd: `${BIN} account create grandma --quota 10G --pair`,
        note: "a new family member, with a QR code for her phone",
      },
      {
        cmd: `${BIN} account pair niclas --agent --perms data:read --apps drive --no-qr`,
        note: "a code for `storage-mcp pair`: an AI agent that may read the drive",
      },
      { cmd: `${BIN} account edit kid --disable`, note: "lock an account out" },
      {
        cmd: `${BIN} account pair niclas --admin-app`,
        note: "pair Storage Remote as an admin device (admin token only)",
      },
      {
        cmd: `${BIN} account ls --role guest -q`,
        note: "names only, for a script",
      },
    ],
    exitCodes: STANDARD_EXITS,
    seeAlso: ["device", "namespace"],
  },
  {
    name: "device",
    aliases: ["devices"],
    group: "admin",
    summary: "List devices, revoke them and remove admin access.",
    usage: `${BIN} device <ls|view|revoke|remove-admin|scope> [<id>...] [flags]`,
    description:
      "The console's Devices page. Devices are named by id or a unique id prefix. Revoking a device ends its sessions and deletes its copy of the account key at once; rotate shared namespace keys from an app afterwards if it was lost. `remove-admin` takes remote console access away from an admin device (it can never be granted back — pair a new one). `scope` narrows what an agent device may do (or makes an ordinary device an agent); a scope never widens.",
    subcommands: [
      {
        name: "ls",
        aliases: ["list"],
        usage: `${BIN} device ls [--account <name>] [--state <state>] [--admin] [--all] [--json | -q | --format <t>]`,
        summary:
          "List devices (revoked ones only with --all or --state revoked).",
        args: [0, 0],
        flags: [
          {
            name: "account",
            type: "string",
            value: "<name>",
            description: "Only this account's devices.",
          },
          {
            name: "state",
            type: "string",
            value: "active|pending|revoked",
            description: "Only devices in this state.",
          },
          { name: "admin", type: "bool", description: "Only admin devices." },
          { name: "agent", type: "bool", description: "Only agent devices." },
          {
            name: "all",
            short: "a",
            type: "bool",
            description: "Include revoked devices.",
          },
          ...LIST_OUTPUT,
        ],
      },
      {
        name: "view",
        usage: `${BIN} device view <id> [--json]`,
        summary: "Show one device.",
        args: [1, 1],
        flags: [JSON_FLAG],
      },
      {
        name: "revoke",
        aliases: ["rm"],
        usage: `${BIN} device revoke <id>... [--yes]`,
        summary: "Revoke devices.",
        args: [1, Infinity],
        flags: [YES_FLAG],
      },
      {
        name: "remove-admin",
        usage: `${BIN} device remove-admin <id>... [--yes]`,
        summary: "Take remote console access away from admin devices.",
        args: [1, Infinity],
        flags: [YES_FLAG],
      },
      {
        name: "scope",
        usage: `${BIN} device scope <id>... --perms <list> [--apps <list>] [--yes]`,
        summary:
          "Narrow agent devices' permissions and apps (never widens; the device signs in again).",
        args: [1, Infinity],
        flags: [
          {
            name: "perms",
            type: "string",
            value: "<list>",
            description:
              'The permissions it keeps, comma-separated ("" for none): data:read, data:write, sharing, devices, console:read, console:write.',
          },
          {
            name: "apps",
            type: "string",
            value: "<list>",
            description:
              "The apps it keeps, comma-separated (default: unchanged if limited, else all).",
          },
          YES_FLAG,
        ],
      },
    ],
    examples: [
      { cmd: `${BIN} device ls --account niclas`, note: "" },
      { cmd: `${BIN} device revoke dev_Q2hhbGxl --yes`, note: "a lost phone" },
      {
        cmd: `${BIN} device scope dev_QWdlbnQ --perms data:read --apps drive`,
        note: "make an AI agent read-only, on the drive only",
      },
      {
        cmd: `${BIN} device ls --state pending -q | xargs ${BIN} device revoke -y`,
        note: "revoke every device that never got its keys",
      },
    ],
    exitCodes: STANDARD_EXITS,
    seeAlso: ["account", "audit"],
  },
  {
    name: "namespace",
    aliases: ["namespaces", "ns"],
    group: "admin",
    summary:
      "List namespaces (metadata only — contents are end-to-end encrypted).",
    usage: `${BIN} namespace <ls|view> [<id>] [flags]`,
    description:
      "The console's Namespaces page: id, app, owner, members and their roles, bytes used, change sequence, key epoch and pending invites. Names and contents are encrypted on the devices and cannot be shown.",
    subcommands: [
      {
        name: "ls",
        aliases: ["list"],
        usage: `${BIN} namespace ls [--app <app>] [--owner <name>] [--json | -q | --format <t>]`,
        summary: "List namespaces.",
        args: [0, 0],
        flags: [
          {
            name: "app",
            type: "string",
            value: "<app>",
            description: "Only this app's namespaces (e.g. meds).",
          },
          {
            name: "owner",
            type: "string",
            value: "<name>",
            description: "Only namespaces this account owns.",
          },
          ...LIST_OUTPUT,
        ],
      },
      {
        name: "view",
        usage: `${BIN} namespace view <id> [--json]`,
        summary: "Show one namespace with its members.",
        args: [1, 1],
        flags: [JSON_FLAG],
      },
    ],
    examples: [
      { cmd: `${BIN} namespace ls --app meds`, note: "" },
      {
        cmd: `${BIN} ns ls --json | jq 'map(.usedBytes) | add'`,
        note: "total bytes in namespaces",
      },
    ],
    exitCodes: STANDARD_EXITS,
    seeAlso: ["account"],
  },
  {
    name: "traffic",
    group: "monitor",
    summary: "Requests, errors and latency per minute and per route.",
    usage: `${BIN} traffic [--minutes <n>] [--json]`,
    description:
      "The console's Traffic page: totals since start, latency percentiles, live SSE connections, a per-minute table (the last 60 minutes are kept) and the per-route table.",
    flags: [
      {
        name: "minutes",
        short: "n",
        type: "int",
        value: "<n>",
        default: "15",
        description: "Minutes of the per-minute table to show.",
      },
      JSON_FLAG,
    ],
    args: [0, 0],
    examples: [
      { cmd: `${BIN} traffic`, note: "" },
      {
        cmd: `${BIN} traffic --json | jq '.routes | sort_by(-.count) | .[0]'`,
        note: "the busiest route",
      },
    ],
    exitCodes: STANDARD_EXITS,
    seeAlso: ["metrics", "status"],
  },
  {
    name: "metrics",
    group: "monitor",
    summary: "Print the Prometheus metrics.",
    usage: `${BIN} metrics`,
    description:
      "The console's /metrics endpoint in the Prometheus text format — the same numbers a scraper sees.",
    flags: [],
    args: [0, 0],
    examples: [{ cmd: `${BIN} metrics | grep storage_devices`, note: "" }],
    exitCodes: STANDARD_EXITS,
    seeAlso: ["traffic"],
  },
  {
    name: "logs",
    group: "monitor",
    summary: "Show or follow the server log; download the debug log file.",
    usage: `${BIN} logs [-f] [--level <level>] [--grep <text>] [-n <lines>] [--json] | ${BIN} logs download [-o <file>]`,
    description:
      "The console's Logs page: the server's in-memory log (the last 2000 entries). -f keeps streaming new entries until interrupted, like `docker logs -f`. `download` fetches the always-on debug log file (its last 5 MiB).",
    defaultSubcommand: "show",
    subcommands: [
      {
        name: "show",
        usage: `${BIN} logs [-f] [--level <level>] [--grep <text>] [-n <lines>] [--json]`,
        summary: "Print recent entries; -f follows.",
        args: [0, 0],
        flags: [
          {
            name: "follow",
            short: "f",
            type: "bool",
            description: "Keep streaming new entries.",
          },
          {
            name: "level",
            short: "l",
            type: "string",
            value: "debug|info|warn|error",
            description: "Only this level and above.",
          },
          {
            name: "grep",
            short: "g",
            type: "string",
            value: "<text>",
            description:
              "Only entries containing this text (case-insensitive).",
          },
          {
            name: "tail",
            short: "n",
            type: "int",
            value: "<lines>",
            default: "100",
            description: "Entries to print before following (max 2000).",
          },
          {
            name: "json",
            type: "bool",
            description: "One JSON object per line.",
          },
        ],
      },
      {
        name: "download",
        usage: `${BIN} logs download [-o <file>]`,
        summary: "Save the server's debug log file.",
        args: [0, 0],
        flags: [{ ...OUTPUT_FILE, default: "storage-debug.log" }],
      },
    ],
    examples: [
      { cmd: `${BIN} logs -f --level warn`, note: "watch for problems" },
      { cmd: `${BIN} logs --grep acme -n 500`, note: "" },
      { cmd: `${BIN} logs download -o - | less`, note: "" },
    ],
    exitCodes: STANDARD_EXITS,
    seeAlso: ["audit", "doctor"],
  },
  {
    name: "audit",
    group: "monitor",
    summary: "Read and verify the tamper-evident audit log.",
    usage: `${BIN} audit <ls|verify> [flags]`,
    description:
      "The console's Audit page. Every security-relevant event (pairing, sign-in failures, revocations, sharing, key rotation, deletions, console changes) is hash-chained; `verify` recomputes the chain and exits 1 when it is broken.",
    defaultSubcommand: "ls",
    subcommands: [
      {
        name: "ls",
        aliases: ["list"],
        usage: `${BIN} audit ls [--action <action>] [--before <id>] [-n <n>] [--json | --format <t>]`,
        summary: "Show the newest entries.",
        args: [0, 0],
        flags: [
          {
            name: "action",
            type: "string",
            value: "<action>",
            description:
              "Only this action or family, e.g. device or device.revoke.",
          },
          {
            name: "before",
            type: "int",
            value: "<id>",
            description: "Only entries older than this id (paging).",
          },
          {
            name: "limit",
            short: "n",
            type: "int",
            value: "<n>",
            default: "50",
            description: "Entries to show (max 500).",
          },
          JSON_FLAG,
          FORMAT_FLAG,
        ],
      },
      {
        name: "verify",
        usage: `${BIN} audit verify [--json]`,
        summary: "Recompute the hash chain; exit 1 if it is broken.",
        args: [0, 0],
        flags: [JSON_FLAG],
      },
    ],
    examples: [
      { cmd: `${BIN} audit ls --action device -n 20`, note: "" },
      { cmd: `${BIN} audit verify`, note: "" },
    ],
    exitCodes: [
      { code: 0, meaning: "success (verify: the chain is intact)" },
      { code: 1, meaning: "the chain is broken, or the request failed" },
      { code: 2, meaning: "invalid usage" },
      { code: 4, meaning: "not logged in, or the credentials were rejected" },
    ],
    seeAlso: ["logs", "doctor"],
  },
  {
    name: "doctor",
    aliases: ["checks"],
    group: "monitor",
    summary: "Run the server's health checks and print a fix for each problem.",
    usage: `${BIN} doctor [--json]`,
    description:
      "The console's Troubleshoot checks, run now on the server: data directory, database integrity, audit chain, an admin exists, disk space, certificate, port mapping and NAT, the public URL, network exposure and recent errors. Exits 1 when any check fails.",
    flags: [JSON_FLAG],
    args: [0, 0],
    examples: [{ cmd: `${BIN} doctor`, note: "" }],
    exitCodes: [
      { code: 0, meaning: "no check failed" },
      { code: 1, meaning: "a check failed, or the request failed" },
      { code: 2, meaning: "invalid usage" },
      { code: 4, meaning: "not logged in, or the credentials were rejected" },
    ],
    seeAlso: ["status", "system"],
  },
  {
    name: "system",
    group: "admin",
    summary:
      "Configuration, housekeeping, backups, certificate renewal, port mapping and diagnostics.",
    usage: `${BIN} system <config|housekeeping|backup|renew-cert|refresh-ports|diagnostics> [flags]`,
    description:
      "The console's Troubleshoot actions. `backup` writes a consistent copy into backups/ in the server's data directory. `diagnostics` downloads the bug-report bundle: overview, checks, redacted configuration, traffic and the last 500 log entries — no tokens, codes or user content.",
    subcommands: [
      {
        name: "config",
        usage: `${BIN} system config [--json]`,
        summary: "Print the effective (redacted) server configuration.",
        args: [0, 0],
        flags: [JSON_FLAG],
      },
      {
        name: "housekeeping",
        usage: `${BIN} system housekeeping [--json]`,
        summary: "Purge expired trash, tombstones and uploads now.",
        args: [0, 0],
        flags: [JSON_FLAG],
      },
      {
        name: "backup",
        usage: `${BIN} system backup [--json]`,
        summary: "Write a backup into the server's data directory.",
        args: [0, 0],
        flags: [JSON_FLAG],
      },
      {
        name: "renew-cert",
        usage: `${BIN} system renew-cert [--json]`,
        summary: "Obtain a new ACME certificate now (--tls acme only).",
        args: [0, 0],
        flags: [JSON_FLAG],
      },
      {
        name: "refresh-ports",
        usage: `${BIN} system refresh-ports [--json]`,
        summary: "Renew the router port mapping now (--upnp only).",
        args: [0, 0],
        flags: [JSON_FLAG],
      },
      {
        name: "diagnostics",
        usage: `${BIN} system diagnostics [-o <file>]`,
        summary: "Save the diagnostics bundle for a bug report.",
        args: [0, 0],
        flags: [
          {
            ...OUTPUT_FILE,
            default: "storage-diagnostics-<time>.json",
          },
        ],
      },
    ],
    examples: [
      { cmd: `${BIN} system config --json | jq .tls`, note: "" },
      { cmd: `${BIN} system backup`, note: "" },
      { cmd: `${BIN} system diagnostics -o report.json`, note: "" },
    ],
    exitCodes: STANDARD_EXITS,
    seeAlso: ["doctor", "settings", "status"],
  },
  {
    name: "settings",
    group: "admin",
    summary: "How long earlier file versions and deleted files are kept.",
    usage: `${BIN} settings <show|set|reset> [flags]`,
    description:
      "The console's Settings page. When a file is overwritten, the server keeps the version it replaced for --history-days (default 30) after the replacement, at most --history-versions per file; deleted files wait in the trash for --trash-days. A value set here wins over the server's configuration (flags, environment, config.json) and applies at once; `reset` goes back to the configuration's value. The versions stay encrypted: only the account's devices can open or compare them.",
    subcommands: [
      {
        name: "show",
        usage: `${BIN} settings show [--json]`,
        summary: "Print the settings and where each comes from.",
        args: [0, 0],
        flags: [JSON_FLAG],
      },
      {
        name: "set",
        usage: `${BIN} settings set [--history-days <days>] [--history-versions <n>] [--trash-days <days>] [--json]`,
        summary: "Change one or more settings.",
        args: [0, 0],
        flags: [
          {
            name: "history-days",
            type: "int",
            value: "<days>",
            description:
              "Keep a replaced version this many days (0 = keep none).",
          },
          {
            name: "history-versions",
            type: "int",
            value: "<n>",
            description: "Keep at most this many versions per file.",
          },
          {
            name: "trash-days",
            type: "int",
            value: "<days>",
            description: "Keep deleted files this many days.",
          },
          JSON_FLAG,
        ],
      },
      {
        name: "reset",
        usage: `${BIN} settings reset <history-days|history-versions|trash-days>... [--json]`,
        summary: "Go back to the server configuration's value.",
        args: [1, 3],
        flags: [JSON_FLAG],
      },
    ],
    examples: [
      { cmd: `${BIN} settings set --history-days 90`, note: "" },
      { cmd: `${BIN} settings reset history-days`, note: "" },
      { cmd: `${BIN} settings show --json | jq .retention`, note: "" },
    ],
    exitCodes: STANDARD_EXITS,
    seeAlso: ["system"],
  },
  {
    name: "api",
    group: "core",
    summary: "Make an authenticated request to the console API.",
    usage: `${BIN} api <path> [-X <method>] [-f <key=value>]... [-F <key=value>]... [--input <file>]`,
    description:
      "Like `gh api`: sends a request to any console endpoint with the current credentials and prints the answer (pretty JSON on a terminal). The path is a console path (/api/accounts, /metrics) or short (accounts); with an admin device it is sent to /v1/console/<path>. -f adds a string field, -F a typed one (numbers, true, false, null); fields make a POST unless -X says otherwise. Exits 1 on an error status.",
    flags: [
      {
        name: "method",
        short: "X",
        type: "string",
        value: "<method>",
        default: "GET (POST with fields or --input)",
        description: "HTTP method.",
      },
      {
        name: "field",
        short: "f",
        type: "list",
        value: "<key=value>",
        description: "Add a string field to the JSON body (repeatable).",
      },
      {
        name: "typed-field",
        short: "F",
        type: "list",
        value: "<key=value>",
        description: "Add a number, boolean or null field (repeatable).",
      },
      {
        name: "input",
        type: "string",
        value: "<file>",
        description: "Send this file ('-' for stdin) as the JSON body.",
      },
    ],
    args: [1, 1],
    examples: [
      { cmd: `${BIN} api overview`, note: "" },
      {
        cmd: `${BIN} api accounts -f name=kid -f role=guest -F quotaBytes=1073741824`,
        note: "create an account",
      },
      {
        cmd: `${BIN} api /api/devices/dev_x -X PATCH -F console=false`,
        note: "",
      },
    ],
    exitCodes: STANDARD_EXITS,
    seeAlso: ["auth"],
  },
  {
    name: "commands",
    group: "meta",
    summary: "List commands in a stable, grep-friendly format.",
    usage: `${BIN} commands [<name>] [--examples]`,
    description:
      "With no name, one line per command. With a name, that command's subcommands, flags and exit codes. --examples adds example invocations.",
    flags: [
      {
        name: "examples",
        type: "bool",
        description: "Show example invocations.",
      },
    ],
    args: [0, 1],
    examples: [
      { cmd: `${BIN} commands`, note: "" },
      { cmd: `${BIN} commands account`, note: "" },
    ],
    exitCodes: STANDARD_EXITS,
    seeAlso: ["help"],
  },
  {
    name: "help",
    group: "meta",
    summary: "Show help for a command.",
    usage: `${BIN} help [<command>]`,
    description:
      "The same text as `<command> --help`. `--help-agent` prints a prompt-ready description of the whole tool.",
    flags: [],
    args: [0, 2],
    examples: [{ cmd: `${BIN} help account`, note: "" }],
    exitCodes: STANDARD_EXITS,
    seeAlso: ["commands"],
  },
  {
    name: "version",
    group: "meta",
    summary: "Print the version.",
    usage: `${BIN} version`,
    description: "Prints the CLI's version (also --version).",
    flags: [],
    args: [0, 0],
    examples: [{ cmd: `${BIN} version`, note: "" }],
    exitCodes: STANDARD_EXITS,
    seeAlso: ["status"],
  },
];

export function findCommand(name: string): CommandSpec | undefined {
  return COMMANDS.find((c) => c.name === name || c.aliases?.includes(name));
}

export function findSubcommand(
  c: CommandSpec,
  name: string,
): SubcommandSpec | undefined {
  return c.subcommands?.find(
    (s) => s.name === name || s.aliases?.includes(name),
  );
}

/** Every environment variable the CLI reads. */
export const ENV_VARS: { name: string; description: string }[] = [
  {
    name: "STORAGE_URL",
    description:
      "Server to talk to: the console listener (with STORAGE_TOKEN, default http://127.0.0.1:8081) or the server's API URL (with STORAGE_SESSION). Alone, it picks the saved context with that URL.",
  },
  {
    name: "STORAGE_TOKEN",
    description:
      "The admin console token (admin.token in the server's data directory).",
  },
  {
    name: "STORAGE_TOKEN_FILE",
    description:
      "Read STORAGE_TOKEN from this file (Docker secrets, or the server's admin.token).",
  },
  {
    name: "STORAGE_SESSION",
    description:
      "An admin-device session printed by `storage auth export` (URL, device id and key).",
  },
  {
    name: "STORAGE_SESSION_FILE",
    description: "Read STORAGE_SESSION from this file.",
  },
  {
    name: "STORAGE_FINGERPRINT",
    description:
      "Pin the server's TLS key (SPKI SHA-256, base64url) instead of trusting the system CAs.",
  },
  {
    name: "STORAGE_CONTEXT",
    description: "Saved context to use instead of the current one.",
  },
  {
    name: "STORAGE_CONFIG_DIR",
    description:
      "Where config.json (the saved contexts) lives. Default: $XDG_CONFIG_HOME/storage (~/.config/storage), %APPDATA%\\storage on Windows.",
  },
  {
    name: "STORAGE_DATA_DIR",
    description:
      "On the server's machine: with no other credentials, read admin.token from this data directory (default: the server's default).",
  },
  {
    name: "STORAGE_ADMIN_PORT",
    description:
      "On the server's machine: the console port used with the data directory's token (default 8081).",
  },
  {
    name: "STORAGE_DEBUG",
    description: "Set to 1 to print each HTTP request to stderr.",
  },
  { name: "NO_COLOR", description: "Set to disable ANSI colours." },
  {
    name: "NODE_EXTRA_CA_CERTS",
    description: "Extra CA certificates to trust (a PEM file), read by Node.",
  },
];
