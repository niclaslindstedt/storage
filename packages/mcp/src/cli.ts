// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// `storage-mcp`: pair an agent device (a person does this, at a terminal),
// then let an MCP client run `storage-mcp serve`. Pairing is deliberately
// not a tool: an agent never enrols itself, never sees a pairing code it
// did not get from the person, and never types a recovery key.

import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";

import {
  parseStoragePayload,
  type SelfHostedClient,
  type StoragePairingPayload,
} from "@niclaslindstedt/oss-framework/storage/selfhosted";

import {
  applyFlags,
  baseDir,
  ConfigError,
  defaultConfig,
  GROUP_INFO,
  GROUPS,
  loadConfig,
  type McpConfig,
  type PolicyFlags,
  profileDir,
} from "./config.ts";
import { checkServerUrl, NetError } from "./net.ts";
import {
  PersonOnlyError,
  processTerminal,
  runPerson,
  type Terminal,
} from "./person.ts";
import { serve, UnscopedDeviceError } from "./serve.ts";
import {
  newClient,
  NotPairedError,
  openSession,
  readProfile,
  vaultSource,
  writeProfile,
} from "./session.ts";
import { toolsFor } from "./tools/index.ts";
import { ensurePrivateDir, openFileVault, VaultError } from "./vault.ts";
import { VERSION } from "./version.ts";

const HELP = `storage-mcp ${VERSION} — an MCP server for your self-hosted storage server

Usage:
  storage-mcp pair '<pairing code>' [--name <device name>] [--recover]
  storage-mcp pair [--recover]      finish getting the account key later
  storage-mcp serve [--read-only] [--disable <groups|tools>] [--only <groups|tools>]
                    [--apps <ids>] [--folders <ns ids>]
  storage-mcp status [--json]
  storage-mcp tools [--json]
  storage-mcp config [--init]
  storage-mcp unpair

For a person at a terminal only (they hand out keys, so they are not tools):
  storage-mcp device approve [<device id>]   approve a waiting device (type its safety code)
  storage-mcp device add [--ttl <minutes>]   a QR code that adds a device with the account key
  storage-mcp recovery-key                   replace the account's recovery key
  storage-mcp invite [<ns id>] [--role viewer|editor] [--hours <n>] [--uses <n>] [--app <id>]
They need the device's devices (or sharing) permission and an interactive terminal.

Options for every command:
  --profile <name>   one paired server per profile (default "default")
  --home <dir>       state directory (default $STORAGE_MCP_HOME or ~/.config/storage-mcp)

Pair an agent device on the server's machine first:
  storage-server pair --account <you> --agent --perms data:read --apps drive
(admin console: Accounts → Pair an agent). The server holds the device to
those permissions on every request; the MCP server can only narrow them.

Tool groups (config.json "groups", --disable, --only):
${GROUPS.map((g) => `  ${g.padEnd(8)} ${GROUP_INFO[g]}`).join("\n")}

Environment:
  STORAGE_MCP_PASSPHRASE  seal the key vault with a passphrase (scrypt) instead of a key file
  STORAGE_MCP_HOME        the state directory

Add it to an MCP client, e.g. Claude Code:
  claude mcp add storage -- storage-mcp serve
`;

type Parsed = {
  cmd: string;
  pos: string[];
  flags: Record<string, string | boolean>;
};

const BOOL = new Set([
  "json",
  "recover",
  "read-only",
  "init",
  "help",
  "version",
]);

export function parseArgs(argv: string[]): Parsed {
  const pos: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "-h") flags.help = true;
    else if (a.startsWith("--")) {
      const [name, inline] = a.slice(2).split("=", 2) as [
        string,
        string | undefined,
      ];
      if (BOOL.has(name)) flags[name] = true;
      else {
        const v = inline ?? argv[++i];
        if (v === undefined) throw new UsageError(`--${name} needs a value`);
        flags[name] = v;
      }
    } else pos.push(a);
  }
  return { cmd: pos.shift() ?? "", pos, flags };
}

class UsageError extends Error {}

const list = (v: string | boolean | undefined) =>
  typeof v === "string"
    ? v
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean)
    : undefined;

/** Read a line from the terminal without echoing it (a recovery key). */
function askHidden(question: string): Promise<string> {
  const stdin = process.stdin;
  if (!stdin.isTTY) {
    return new Promise((resolve) => {
      const rl = createInterface({ input: stdin });
      rl.once("line", (l) => {
        rl.close();
        resolve(l);
      });
    });
  }
  process.stderr.write(question);
  return new Promise((resolve) => {
    let value = "";
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    const onData = (ch: string) => {
      for (const c of ch) {
        if (c === "\r" || c === "\n") {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off("data", onData);
          process.stderr.write("\n");
          resolve(value);
          return;
        }
        if (c === "\u0003") process.exit(130);
        if (c === "\u007f") value = value.slice(0, -1);
        else value += c;
      }
    };
    stdin.on("data", onData);
  });
}

export async function main(
  argv: string[],
  env = process.env,
  term: Terminal = processTerminal(),
): Promise<number> {
  const out = term.out;
  const err = term.err;
  let args: Parsed;
  try {
    args = parseArgs(argv);
  } catch (e) {
    err((e as Error).message);
    return 2;
  }
  if (args.flags.version) {
    out(VERSION);
    return 0;
  }
  if (args.flags.help || args.cmd === "" || args.cmd === "help") {
    out(HELP);
    return args.cmd === "" && !args.flags.help ? 2 : 0;
  }
  try {
    const base =
      typeof args.flags.home === "string" ? args.flags.home : baseDir(env);
    const dir = profileDir(
      base,
      (args.flags.profile as string | undefined) ?? "default",
    );
    switch (args.cmd) {
      case "pair":
        return await pair(dir, args, env, out, err);
      case "serve":
        return await runServe(dir, args, env, err);
      case "status":
        return await status(dir, args, env, out);
      case "tools":
        return await tools(dir, args, env, out);
      case "config":
        return config(dir, args, out);
      case "unpair":
        return await unpair(dir, env, out);
      case "device":
      case "recovery-key":
      case "invite":
        return await runPerson(args.cmd, args, dir, loadConfig(dir), env, term);
      default:
        err(`unknown command ${args.cmd} (see storage-mcp --help)`);
        return 2;
    }
  } catch (e) {
    if (
      e instanceof UsageError ||
      e instanceof ConfigError ||
      e instanceof VaultError ||
      e instanceof NetError ||
      e instanceof NotPairedError ||
      e instanceof UnscopedDeviceError ||
      e instanceof PersonOnlyError
    ) {
      err(`storage-mcp: ${e.message}`);
      return e instanceof UsageError ? 2 : 1;
    }
    err(`storage-mcp: ${(e as Error).message}`);
    return 1;
  }
}

function policy(dir: string, args: Parsed): McpConfig {
  const flags: PolicyFlags = {
    readOnly: args.flags["read-only"] === true,
    disable: list(args.flags.disable),
    only: list(args.flags.only),
    apps: list(args.flags.apps),
    folders: list(args.flags.folders),
  };
  return applyFlags(loadConfig(dir), flags);
}

type MeView = {
  agent: { perms: string[]; apps: string[] | null } | null;
  console: boolean;
  account: { name: string };
  deviceId: string;
};

/**
 * `pair '<code>'` enrols this machine as a device; `pair` (or
 * `pair --recover`) on an already paired profile finishes the key step.
 */
async function pair(
  dir: string,
  args: Parsed,
  env: NodeJS.ProcessEnv,
  out: (s: string) => void,
  err: (s: string) => void,
): Promise<number> {
  const code = args.pos[0];
  const config = loadConfig(dir);
  const existing = readProfile(dir);
  let client: SelfHostedClient;
  if (code) {
    if (existing)
      throw new UsageError(
        "this profile is already paired: `storage-mcp unpair` first, or use --profile <name>",
      );
    const payload = parseStoragePayload(code);
    if (payload.kind !== "pair")
      throw new UsageError("that is an invite, not a pairing code");
    checkServerUrl(payload.server, {
      allowInsecureHttp: config.allowInsecureHttp,
    });
    ensurePrivateDir(dir);
    const profile = {
      server: payload.server,
      ...((payload as StoragePairingPayload).fp ? { pin: payload.fp } : {}),
    };
    client = newClient(openFileVault(dir, vaultSource(env)), profile, config);
    const name =
      typeof args.flags.name === "string"
        ? args.flags.name
        : "AI agent (storage-mcp)";
    await client.pair(payload, { name, platform: "mcp" });
    writeProfile(dir, profile);
    const me = await client.transport.json<MeView>("GET", "/v1/me");
    out(
      `Paired with ${payload.server} as "${name}" on account ${me.account.name}.`,
    );
    out(
      me.agent
        ? `Agent scope (enforced by the server): ${me.agent.perms.join(", ") || "none"}; apps: ${me.agent.apps?.join(", ") ?? "all"}${me.console ? "; admin device" : ""}.`
        : 'WARNING: this is an ordinary, unscoped device — it can do everything the account can. `storage-mcp serve` refuses to run with it unless config.json says "allowUnscoped": true. Pair with `storage-server pair --account <you> --agent` instead.',
    );
  } else {
    if (!existing)
      throw new UsageError("storage-mcp pair '<pairing code>' [--recover]");
    client = newClient(openFileVault(dir, vaultSource(env)), existing, config);
    if ((await client.restore()) === "signed-out") throw new NotPairedError();
  }

  const me = await client.transport.json<MeView>("GET", "/v1/me");
  const needsKeys =
    me.agent === null ||
    me.agent.perms.some(
      (p) => p.startsWith("data:") || p === "sharing" || p === "devices",
    );
  if (needsKeys && (await client.refreshKeys()) !== "ready") {
    if (args.flags.recover) {
      const rk = await askHidden("Recovery key (not shown): ");
      await client.recover(rk.trim());
    } else {
      out(
        `\nTo read encrypted data this device needs the account key. On a device that has it (Storage Remote → This phone), approve this device when it shows this safety code:\n\n    ${await client.safetyCode()}\n\nWaiting for approval (Ctrl-C to stop; run \`storage-mcp pair\` again later, or \`storage-mcp pair --recover\` to use the recovery key)…`,
      );
      await client.waitForApproval({ intervalMs: 3000 });
    }
    out("The account key is on this device.");
  }
  err(
    `Keys are sealed in ${join(dir, "vault.json")}${vaultSource(env).kind === "keyfile" ? ` with ${join(dir, "vault.key")}` : " with your passphrase"}.`,
  );
  out(
    "\nAdd it to your MCP client, e.g.\n  claude mcp add storage -- storage-mcp serve" +
      (dir.endsWith("/default") ? "" : ` --profile ${dir.split("/").pop()}`),
  );
  return 0;
}

async function runServe(
  dir: string,
  args: Parsed,
  env: NodeJS.ProcessEnv,
  err: (s: string) => void,
): Promise<number> {
  const config = policy(dir, args);
  await serve({
    dir,
    config,
    input: process.stdin,
    output: process.stdout,
    env,
    log: (level, message) => err(`[${level}] ${message}`),
  });
  return 0;
}

async function status(
  dir: string,
  args: Parsed,
  env: NodeJS.ProcessEnv,
  out: (s: string) => void,
) {
  const config = policy(dir, args);
  const session = await openSession(dir, config, env);
  const { me } = session;
  const offered = toolsFor(config, me);
  const report = {
    server: session.profile.server,
    pinned: Boolean(session.profile.pin),
    device: me.deviceId,
    account: me.account,
    adminDevice: me.console,
    scope: me.agent,
    accountKey: session.ready,
    safetyCode: session.ready ? undefined : await session.client.safetyCode(),
    tools: offered.filter((t) => t.enabled).map((t) => t.tool.name),
  };
  if (args.flags.json) out(JSON.stringify(report, null, 2));
  else {
    out(
      `Server:      ${report.server}${report.pinned ? " (certificate pinned)" : ""}`,
    );
    out(`Account:     ${me.account.name} (${me.account.role})`);
    out(`Device:      ${me.deviceId}${me.console ? " — admin device" : ""}`);
    out(
      `Scope:       ${me.agent ? `${me.agent.perms.join(", ") || "none"}; apps: ${me.agent.apps?.join(", ") ?? "all"}` : "UNSCOPED (full account access)"}`,
    );
    out(
      `Account key: ${session.ready ? "on this device" : `missing — approve this device; its safety code is ${report.safetyCode}`}`,
    );
    out(
      `Tools:       ${report.tools.length} offered (storage-mcp tools for details)`,
    );
  }
  return 0;
}

async function tools(
  dir: string,
  args: Parsed,
  env: NodeJS.ProcessEnv,
  out: (s: string) => void,
) {
  const config = policy(dir, args);
  const session = await openSession(dir, config, env);
  const rows = toolsFor(config, session.me);
  if (args.flags.json)
    out(
      JSON.stringify(
        rows.map((r) => ({
          name: r.tool.name,
          groups: r.tool.groups,
          access: r.tool.access,
          permission: r.tool.perm,
          enabled: r.enabled,
          ...(r.reason ? { reason: r.reason } : {}),
        })),
        null,
        2,
      ),
    );
  else
    for (const r of rows)
      out(
        `${r.enabled ? "on " : "off"}  ${r.tool.name.padEnd(24)} ${r.tool.groups.join("/").padEnd(14)} ${r.tool.access.padEnd(5)} ${r.reason ?? ""}`.trimEnd(),
      );
  return 0;
}

function config(dir: string, args: Parsed, out: (s: string) => void): number {
  const file = join(dir, "config.json");
  if (args.flags.init) {
    if (existsSync(file)) throw new UsageError(`${file} exists`);
    ensurePrivateDir(dir);
    const c = defaultConfig();
    writeFileSync(
      file,
      `${JSON.stringify(
        {
          groups: c.groups,
          deny: c.deny,
          allow: c.allow,
          apps: c.apps,
          folders: c.folders,
          confirm: c.confirm,
          limits: c.limits,
          audit: c.audit,
        },
        null,
        2,
      )}\n`,
      { mode: 0o600 },
    );
    out(`Wrote ${file}`);
    return 0;
  }
  out(`# ${file}${existsSync(file) ? "" : " (not present: defaults)"}`);
  out(JSON.stringify(loadConfig(dir), null, 2));
  return 0;
}

async function unpair(
  dir: string,
  env: NodeJS.ProcessEnv,
  out: (s: string) => void,
) {
  const profile = readProfile(dir);
  if (!profile) throw new NotPairedError();
  const config = loadConfig(dir);
  const vault = openFileVault(dir, vaultSource(env));
  const client = newClient(vault, profile, config);
  if ((await client.restore()) !== "signed-out") {
    try {
      // Revoke this device on the server: its tokens and key copy die.
      await client.revokeDevice(client.session!.deviceId);
    } catch {
      out(
        "Could not reach the server to revoke this device; revoke it in the admin console.",
      );
    }
  }
  vault.destroy();
  rmSync(join(dir, "profile.json"), { force: true });
  out("Unpaired: this device is revoked and its keys are erased.");
  return 0;
}
