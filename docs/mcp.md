# AI agents (MCP)

`storage-mcp` is a [Model Context Protocol](https://modelcontextprotocol.io)
server that lets an AI agent — Claude Code, Claude Desktop, any MCP client —
use your storage server: read and write your files and app data, share
folders, manage devices, and run the server the way the
[admin console](admin-console.md) and [Storage Remote](remote-app.md) do.

It is built for data you would not hand to just anyone. The agent runs on
an **agent device**: a device of your account that the server holds to the
permissions and apps you grant when you pair it, on every request. Your
files are decrypted by `storage-mcp` on your machine, never by the server,
and every action that could delete data, share it or mint a credential is
confirmed by you, in your MCP client — not by the model.

## How it works

```
 you ─ MCP client (Claude …) ─ stdio ─ storage-mcp ─ HTTPS ─ storage-server
        the model sees tool           holds the keys,        enforces the
        results only                  decrypts, asks you     agent's scope
```

- `storage-mcp` is a device of your account with its own keys, kept in an
  encrypted vault on your machine. It talks to one server only.
- The **scope** (what the agent may do) is set when you pair it, at the
  machine or by one of your devices, and enforced by the server. It can be
  narrowed later, never widened.
- A **local policy** (`config.json`, flags) decides which tools the agent is
  even shown. It can only take away from the scope.

## Set it up

1. **Pair an agent device.** In the admin console, **Accounts → Pair an
   agent**, tick what the agent may do and, optionally, which apps it may
   see. Or on the server's machine:

   ```sh
   storage-server pair --account <you> --agent --perms data:read --apps drive
   ```

   With the headless CLI, from anywhere:
   `storage account pair <you> --agent --perms data:read --apps drive`.

   `--perms` takes any of `data:read`, `data:write`, `sharing`, `devices`,
   and — with `--console`, for an admin account — `console:read`,
   `console:write`. Without `--perms` the agent may read, nothing more.

2. **Pair `storage-mcp`** on the machine the agent runs on:

   ```sh
   echo "@niclaslindstedt:registry=https://npm.pkg.github.com" >> ~/.npmrc
   npm install -g @niclaslindstedt/storage-mcp
   storage-mcp pair 'oss-storage://pair?v=1&s=…'
   ```

3. **Give it the account key** (only for data, sharing and device
   permissions). `storage-mcp pair` shows a safety code and waits: approve
   the new device in Storage Remote (**This phone → Waiting for your key**)
   after checking the codes match (stopped waiting? `storage-mcp pair` picks
   it up again). Or run `storage-mcp pair --recover '…'`
   and type your recovery key (it is not echoed and never leaves the
   machine).

4. **Add it to your MCP client**, for example:

   ```sh
   claude mcp add storage -- storage-mcp serve
   ```

   or in a client's JSON configuration:

   ```json
   {
     "mcpServers": {
       "storage": { "command": "storage-mcp", "args": ["serve"] }
     }
   }
   ```

`storage-mcp status` shows what it is paired to, its scope and whether it
has the key; `storage-mcp tools` lists every tool with why it is on or off.

## What an agent can do

| Permission      | Tool group         | Tools                                                                                                                                                                                                                          |
| --------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `data:read`     | `files`, `records` | `list_namespaces`, `list_files`, `file_info`, `read_file`, `file_history`, `read_file_version`, `list_trash`, `watch_changes`, `list_collections`, `list_records`, `get_record`, `list_members`                                |
| `data:write`    | `files`, `records` | `create_namespace`, `rename_namespace`, `delete_namespace`, `write_file`, `make_folder`, `move`, `copy_file`, `delete_file`, `restore_file_version`, `restore_from_trash`, `purge_from_trash`, `put_record`, `delete_record`   |
| `sharing`       | `sharing`          | `list_invites`, `create_invite`, `revoke_invite`, `set_member_role`, `remove_member`, `rotate_namespace_key`, `join_shared_folder`, `leave_namespace`                                                                          |
| `devices`       | `devices`          | `list_my_devices`, `list_pending_devices`, `approve_device`, `add_device`, `rename_device`, `revoke_my_device`, `new_recovery_key`                                                                                             |
| `console:read`  | `server`, `logs`   | `server_overview`, `server_checks`, `server_traffic`, `server_config`, `list_accounts`, `list_all_devices`, `list_all_namespaces`, `read_logs`, `read_debug_log`, `read_audit_log`, `verify_audit_chain`, `diagnostics_bundle` |
| `console:write` | `admin`            | `create_account`, `update_account`, `delete_account`, `create_pairing`, `revoke_device`, `remove_admin_access`, `narrow_device_scope`, `run_housekeeping`, `renew_certificate`, `refresh_port_mapping`, `create_backup`        |
| —               | —                  | `whoami` — what the agent is paired to and may do                                                                                                                                                                              |

That is every page of the admin console and everything Storage Remote does,
tool for tool (a test keeps it that way). Namespaces are referenced by id
(`ns_…`); `list_namespaces` shows them with their decrypted names. The drive
is the `drive` app; other apps' namespaces (notes, meds, calendar …) are
reached the same way, files and rows alike.

## Turn things off

The agent is only ever shown tools that its scope allows **and** the local
policy allows. Keep the policy in `~/.config/storage-mcp/default/config.json`
(`storage-mcp config --init` writes one with every key):

```json
{
  "groups": {
    "server": "read",
    "logs": "off",
    "admin": "off",
    "files": "read",
    "records": "off",
    "sharing": "off",
    "devices": "off"
  },
  "deny": ["read_file_version"],
  "apps": ["drive"],
  "folders": ["ns_AAAAAAAAAAAAAAAAAAAAAA"],
  "confirm": "require",
  "secrets": "outbox"
}
```

| Key                 | Meaning                                                                                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `groups`            | per group: `off`, `read` or `write` (default `write`: whatever the scope grants)                                                                        |
| `deny`              | tools never offered                                                                                                                                     |
| `allow`             | when set, only these tools (or groups) are offered                                                                                                      |
| `apps`, `folders`   | only namespaces of these apps / with these ids are touched                                                                                              |
| `confirm`           | `require` (default): confirmations are asked through the client and refused if it cannot ask. `host`: rely on your client's own per-call prompt instead |
| `secrets`           | `outbox` (default): pairing codes, invites and recovery keys go to a private file. `off`: the tools that make them are not offered                      |
| `limits`            | `callsPerMinute` (60), `burst` (20), `maxConcurrent` (4), `maxReadBytes` (256 KiB), `maxWriteBytes` (10 MiB), `maxListEntries` (500)                    |
| `audit`             | keep the local audit log (default `true`)                                                                                                               |
| `allowUnscoped`     | serve with an ordinary, unscoped device (default `false`)                                                                                               |
| `allowInsecureHttp` | allow plain HTTP to a server that is not on this machine (tests only)                                                                                   |

Flags on `serve` narrow further for one client, without touching the file:

```sh
storage-mcp serve --read-only                 # every group capped at read
storage-mcp serve --disable logs,sharing      # groups or tool names
storage-mcp serve --only read_file,list_files # nothing else
storage-mcp serve --apps drive --folders ns_… # these namespaces only
```

To take a permission away for good, narrow the device's scope instead: it
is enforced by the server, so it holds even if the agent can edit files on
its machine: `storage device scope <id> --perms data:read --apps drive`
with the [headless CLI](cli.md), `narrow_device_scope` from an admin agent,
or `PATCH /api/devices/:id {"agent": {"perms": [...], "apps": [...]}}` on
the console API. Revoke the device to end it.

## Security

An agent that reads private data, reads text other people wrote, and can
send things somewhere has all three parts of what Simon Willison calls the
_lethal trifecta_: a prompt injection hidden in a shared file could make it
leak the rest. `storage-mcp` is designed to keep each leg as short as it
can, and to put a person or the server — never the model — in front of
everything that matters.

**The boundary is the server.** The agent's permissions and apps are
stored with its device and checked on every request, before any handler
runs; a route that is not classified is refused (fail closed). A scope is
granted only when a pairing is minted — at the machine, or by a device that
already has at least that much — and narrowed, never widened, afterwards.
Devices an agent adds, and pairings an agent admin device mints, inherit
its scope. Console permissions need an admin-device pairing, which only the
local console and the CLI can make. An agent without `devices` can store
its own copy of the account key once and nothing else: it cannot approve
another device, replace the recovery key or pair a device.

**The local policy decides what the model sees.** Disabled tools are not
listed, so the model cannot be talked into calling them. The tool list is
fixed for the life of the process (no `list_changed`, no rug pulls).

**People confirm, through the client.** Actions that delete for good,
share, change accounts or mint credentials ask the person with an MCP
[elicitation](https://modelcontextprotocol.io/specification/2026-07-28/client/elicitation)
— a form shown by the client, answered by the person. With the 2026-07-28
protocol the answer comes back with a `requestState` sealed with HMAC-SHA-256
and bound to the exact tool and arguments; it expires after 10 minutes and
works once. Deleting an account or a folder needs its name typed.
Approving a device needs the safety code the new device shows, typed by the
person and compared with the code computed here from the keys the account
key would be sealed to. If the client cannot ask, the action is refused.

**Secrets stay out of the model's context.** Pairing codes, device-adding
QR codes, invites and new recovery keys are written to
`<profile>/outbox/` (mode 0600, pruned after a day, with a QR `.svg`); the
model is told only where the file is. Nothing the tools return contains a
token or key material.

**Content is data.** File contents, rows, names and log lines are wrapped in
`<untrusted-… id="…">` fences whose boundary is random per result, so text
cannot close the fence and speak as the tool; the server's instructions
tell the model never to follow instructions inside them. Names lose control,
bidi-override and zero-width characters. Results are size-capped.

**One server, over TLS.** `storage-mcp` refuses to send a request anywhere
but its own server's origin, requires HTTPS except to this machine, follows
no redirects, and — when the pairing code carried the server's key
fingerprint (self-signed certificates) — checks the key before a byte of
the request is sent. It never listens on a port: stdio only.

**Keys at rest.** Device keys and the account key are kept in `vault.json`,
sealed with AES-256-GCM under a key in `vault.key`, or derived from
`STORAGE_MCP_PASSPHRASE` with scrypt (N=2¹⁷). Both files are created 0600
in a 0700 directory, and `storage-mcp` refuses to start if anyone else can
read them. Keys are imported non-extractable while it runs.

**A record of everything.** Every tool call is appended to
`<profile>/audit.log` (content replaced by its size and a hash), and every
change is in the server's tamper-evident audit chain under the device's id.
Tool calls are rate limited (60/min, bursts of 20, 4 at a time).

**No supply chain.** `storage-mcp` has no runtime dependencies: the protocol,
the vault and the network layer are written against Node's standard
library, and the framework's end-to-end encryption client is bundled from
source.

Some advice:

- Grant the least that does the job. `data:read` on one app is a very
  different agent from `data:write` + `sharing` on everything.
- Do not enable `sharing` or `devices` for an agent that also reads files
  other people can write to, unless you watch every confirmation.
- Whatever the agent reads may be sent to its model provider. Health data
  included.
- `confirm: host` is only as strong as your client's approval prompt; leave
  it at `require` unless your client asks before every call.

## Protocol support

`storage-mcp` speaks MCP 2026-07-28 (stateless: `server/discover`,
per-request `_meta`, multi-round-trip elicitation) and, for older clients,
2025-11-25, 2025-06-18, 2025-03-26 and 2024-11-05 through `initialize`, on
the stdio transport. It offers tools only (no resources, prompts or
sampling). Tool annotations mark read-only, destructive and idempotent tools;
`openWorldHint` is false for all of them.

## Files

Per profile (`--profile <name>`, default `default`) under
`$STORAGE_MCP_HOME`, else `$XDG_CONFIG_HOME/storage-mcp`, else
`~/.config/storage-mcp`:

| File           | Holds                                                  |
| -------------- | ------------------------------------------------------ |
| `vault.json`   | device keys, the account key, the session (encrypted)  |
| `vault.key`    | the vault's key (absent with a passphrase)             |
| `profile.json` | the server URL and certificate pin                     |
| `config.json`  | the local policy (optional)                            |
| `audit.log`    | every tool call, content redacted                      |
| `outbox/`      | secrets for you: pairing codes, invites, recovery keys |

`storage-mcp unpair` revokes the device on the server and erases all of it.

## Troubleshooting

- **"not an agent device"**: the code was an ordinary pairing. Pair with
  `--agent` (or **Pair an agent**), or narrow the device in the console.
- **"this agent has no account key yet"**: approve it from another device
  (`storage-mcp status` shows its safety code), or run
  `storage-mcp pair --recover` and type the recovery key.
- **"needs a person to confirm it, and this MCP client cannot ask"**: the
  client does not support elicitation. Do it in the console or Storage
  Remote, or set `"confirm": "host"` if your client asks before every call.
- **A tool is missing**: `storage-mcp tools` says whether the scope or the
  local policy turned it off.
- **403 from the server**: the device's scope does not allow it. That is
  the point — pair a new agent if it should.
