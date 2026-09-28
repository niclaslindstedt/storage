// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The admin console, for an agent on an admin device (SPEC §11.1, §11.2):
// the same API the console's pages and Storage Remote's Server tab use, at
// /v1/console. It shows what the server sees — names, roles, sizes, counts,
// timestamps — never content. Groups: `server` (read), `logs` (read),
// `admin` (changes).

import { s } from "../protocol/schema.ts";
import { consoleJson } from "../session.ts";
import { capText, cleanName, cleanText, fence } from "../text.ts";
import { arg } from "./common.ts";
import { json, text, type ToolDef, ToolError } from "./registry.ts";

const read = { access: "read", perm: "console:read", console: true } as const;
const write = {
  access: "write",
  perm: "console:write",
  console: true,
} as const;
const empty = s.object({});

const ROLE = s.enum("Account role.", ["admin", "member", "guest"]);

type Account = { id: string; name: string; role: string };
type DeviceRow = { id: string; name: string; account: string };

async function account(deps: Parameters<ToolDef["run"]>[1], id: string) {
  const all = await consoleJson<Account[]>(deps.client, "GET", "accounts");
  const a = all.find((x) => x.id === id);
  if (!a) throw new ToolError(`no account ${id}`);
  return a;
}

async function deviceRow(deps: Parameters<ToolDef["run"]>[1], id: string) {
  const all = await consoleJson<DeviceRow[]>(deps.client, "GET", "devices");
  const d = all.find((x) => x.id === id);
  if (!d) throw new ToolError(`no device ${id}`);
  return d;
}

export const consoleTools: ToolDef[] = [
  // ---- server (read) ------------------------------------------------------------
  {
    name: "server_overview",
    title: "Server overview",
    description:
      "The admin console's overview: health verdict, uptime, version, URLs, TLS and certificate expiry, port mapping, storage use and disk space, counts, recent problems.",
    groups: ["server"],
    ...read,
    input: empty,
    run: async (_a, d) => json(await consoleJson(d.client, "GET", "overview")),
  },
  {
    name: "server_checks",
    title: "Run health checks",
    description:
      "Run the server's health checks (data directory, database, audit chain, disk, certificate, port mapping, reachability, exposure, recent errors). Each has a status (ok, warn, fail, skip), detail and a fix hint.",
    groups: ["server"],
    ...read,
    input: empty,
    run: async (_a, d) => json(await consoleJson(d.client, "GET", "checks")),
  },
  {
    name: "server_traffic",
    title: "Traffic and latency",
    description:
      "Request totals, 4xx/5xx and rate-limited counts, latency percentiles, the busiest routes and live event-stream connections (last 60 minutes).",
    groups: ["server"],
    ...read,
    input: empty,
    async run(_a, d) {
      const m = await consoleJson<{
        routes: unknown[];
        totals: unknown;
        latency: unknown;
        sseConnections: number;
        series: unknown;
      }>(d.client, "GET", "metrics");
      return json({
        totals: m.totals,
        latency: m.latency,
        sseConnections: m.sseConnections,
        routes: m.routes.slice(0, 25),
      });
    },
  },
  {
    name: "server_config",
    title: "Effective configuration",
    description: "The server's effective configuration (secrets redacted).",
    groups: ["server"],
    ...read,
    input: empty,
    run: async (_a, d) => json(await consoleJson(d.client, "GET", "config")),
  },
  {
    name: "list_accounts",
    title: "List accounts",
    description:
      "Every account: name, role, quota and usage, device and namespace counts, last seen, disabled state.",
    groups: ["server"],
    ...read,
    input: empty,
    run: async (_a, d) =>
      json({ accounts: await consoleJson(d.client, "GET", "accounts") }),
  },
  {
    name: "list_all_devices",
    title: "List all devices",
    description:
      "Every device on the server: account, platform, key state (active, pending, revoked), last seen, whether it is an admin device, and an agent device's scope.",
    groups: ["server"],
    ...read,
    input: s.object({
      account: s.string("Only devices of this account id.", { maxLength: 64 }),
    }),
    async run(a, d) {
      const all = await consoleJson<{ accountId: string }[]>(
        d.client,
        "GET",
        "devices",
      );
      return json({
        devices: a.account ? all.filter((x) => x.accountId === a.account) : all,
      });
    },
  },
  {
    name: "list_all_namespaces",
    title: "List all namespaces",
    description:
      "Every namespace on the server as the server sees it: id, app, owner, members and roles, usage, sequence, key epoch, pending invites. Names and content are encrypted and not shown.",
    groups: ["server"],
    ...read,
    input: empty,
    run: async (_a, d) =>
      json({ namespaces: await consoleJson(d.client, "GET", "namespaces") }),
  },

  // ---- logs (read) --------------------------------------------------------------
  {
    name: "read_logs",
    title: "Read the server log",
    description:
      "Recent entries from the server's in-memory log (newest last), filtered by level and search text. Log messages are untrusted text.",
    groups: ["logs"],
    ...read,
    input: s.object({
      level: s.enum("Lowest level to include.", [
        "debug",
        "info",
        "warn",
        "error",
      ]),
      search: s.string("Only entries containing this text.", {
        maxLength: 200,
      }),
      after: s.integer(
        "Only entries after this entry id (to page forward).",
        0,
      ),
      limit: arg.limit(500),
    }),
    async run(a, d) {
      const out = await consoleJson<{
        entries: { msg?: string }[];
        counts: unknown;
      }>(d.client, "GET", "logs", undefined, {
        level: a.level as string | undefined,
        q: a.search as string | undefined,
        after: a.after as number | undefined,
        limit: (a.limit as number | undefined) ?? 200,
      });
      return json(out);
    },
  },
  {
    name: "read_debug_log",
    title: "Read the debug log file",
    description:
      "The tail of the server's debug log file (the console's download). Untrusted text.",
    groups: ["logs"],
    ...read,
    input: s.object({
      tailBytes: s.integer(
        "How much of the end of the file (default 65536).",
        1024,
        1024 * 1024,
      ),
    }),
    async run(a, d) {
      const res = await d.client.transport.request(
        "GET",
        "/v1/console/logs/file",
      );
      const all = cleanText(await res.text());
      const want = Math.min(
        (a.tailBytes as number | undefined) ?? 65536,
        d.config.limits.maxReadBytes,
      );
      const bytes = Buffer.from(all, "utf8");
      const tail = bytes
        .subarray(Math.max(0, bytes.length - want))
        .toString("utf8");
      return text(fence("log", "debug log", tail), {
        bytes: bytes.length,
        returned: Buffer.byteLength(tail),
      });
    },
  },
  {
    name: "read_audit_log",
    title: "Read the audit log",
    description:
      "The tamper-evident audit chain, newest first: who (device or console) did what to which target, when, from where.",
    groups: ["logs"],
    ...read,
    input: s.object({
      action: s.string('Only this action, e.g. "device.revoke".', {
        maxLength: 64,
      }),
      before: s.integer("Only entries before this id (to page back).", 0),
      limit: arg.limit(500),
    }),
    run: async (a, d) =>
      json(
        await consoleJson(d.client, "GET", "audit", undefined, {
          action: a.action as string | undefined,
          before: a.before as number | undefined,
          limit: (a.limit as number | undefined) ?? 100,
        }),
      ),
  },
  {
    name: "verify_audit_chain",
    title: "Verify the audit chain",
    description: "Check the audit log's hash chain for edits or truncation.",
    groups: ["logs"],
    ...read,
    input: empty,
    run: async (_a, d) =>
      json(await consoleJson(d.client, "POST", "audit/verify")),
  },
  {
    name: "diagnostics_bundle",
    title: "Diagnostics bundle",
    description:
      "The console's diagnostics bundle: overview, checks, redacted configuration, traffic and the last log entries — what a bug report needs. No tokens, codes or user content.",
    groups: ["logs"],
    ...read,
    input: empty,
    async run(_a, d) {
      const res = await d.client.transport.request(
        "GET",
        "/v1/console/diagnostics",
      );
      const capped = capText(
        cleanText(await res.text()),
        d.config.limits.maxReadBytes,
      );
      return text(fence("json", "diagnostics bundle", capped.text), {
        truncated: capped.truncated,
      });
    },
  },

  // ---- admin (changes) ------------------------------------------------------------
  {
    name: "create_account",
    title: "Create an account",
    description:
      "Create an account (no device yet; pair one with create_pairing).",
    groups: ["admin"],
    ...write,
    input: s.object(
      {
        name: s.string("Account name.", { minLength: 1, maxLength: 64 }),
        role: ROLE,
        quotaBytes: s.integer(
          "Storage quota in bytes (omit: the server default).",
          0,
        ),
      },
      ["name"],
    ),
    confirm: (a) => ({
      message: `Create the ${String(a.role ?? "member")} account "${cleanName(a.name)}"?`,
    }),
    run: async (a, d) =>
      json(
        await consoleJson(d.client, "POST", "accounts", {
          name: a.name,
          role: a.role ?? "member",
          quotaBytes: a.quotaBytes,
        }),
      ),
  },
  {
    name: "update_account",
    title: "Change an account",
    description:
      "Rename an account, change its role or quota, or disable / enable it (disabling signs out every device of it).",
    groups: ["admin"],
    ...write,
    destructive: true,
    idempotent: true,
    input: s.object(
      {
        accountId: s.string("The account id.", { maxLength: 64 }),
        name: s.string("New name.", { minLength: 1, maxLength: 64 }),
        role: ROLE,
        quotaBytes: s.integer("New quota in bytes.", 0),
        unlimited: s.boolean("Remove the quota."),
        disabled: s.boolean("Disable (true) or enable (false) the account."),
      },
      ["accountId"],
    ),
    async confirm(a, d) {
      const acc = await account(d, a.accountId as string);
      const changes = Object.entries(a)
        .filter(([k]) => k !== "accountId")
        .map(([k, v]) => `${k} → ${cleanName(v)}`)
        .join(", ");
      return {
        message: `Change account "${cleanName(acc.name)}": ${changes || "nothing"}?`,
      };
    },
    run: async (a, d) =>
      json(
        await consoleJson(
          d.client,
          "PATCH",
          `accounts/${encodeURIComponent(a.accountId as string)}`,
          {
            name: a.name,
            role: a.role,
            quotaBytes: a.unlimited ? null : a.quotaBytes,
            disabled: a.disabled,
          },
        ),
      ),
  },
  {
    name: "delete_account",
    title: "Delete an account",
    description:
      "Delete an account and every namespace it owns, for everyone they are shared with. Cannot be undone. The person must type the account's name to confirm.",
    groups: ["admin"],
    ...write,
    destructive: true,
    input: s.object(
      { accountId: s.string("The account id.", { maxLength: 64 }) },
      ["accountId"],
    ),
    async confirm(a, d) {
      const acc = await account(d, a.accountId as string);
      return {
        message: `Delete the account "${cleanName(acc.name)}" and every namespace it owns? This cannot be undone.`,
        typed: { label: "Account name", expect: acc.name },
        always: true,
      };
    },
    async run(a, d) {
      const acc = await account(d, a.accountId as string);
      return json(
        await consoleJson(
          d.client,
          "DELETE",
          `accounts/${encodeURIComponent(acc.id)}`,
          {
            confirm: acc.name,
          },
        ),
      );
    },
  },
  {
    name: "revoke_device",
    title: "Revoke a device",
    description:
      "Revoke any device on the server (a lost phone): its sessions end and its copy of the account key is deleted at once.",
    groups: ["admin"],
    ...write,
    destructive: true,
    idempotent: true,
    input: s.object({ deviceId: arg.id("The device id (dev_…).") }, [
      "deviceId",
    ]),
    async confirm(a, d) {
      const dev = await deviceRow(d, a.deviceId as string);
      if (dev.id === d.session.me.deviceId)
        throw new ToolError(
          "this is the agent's own device: unpair it with `storage-mcp unpair` instead",
        );
      return {
        message: `Revoke "${cleanName(dev.name)}" (account ${cleanName(dev.account)})?`,
      };
    },
    run: async (a, d) =>
      json(
        await consoleJson(
          d.client,
          "DELETE",
          `devices/${encodeURIComponent(a.deviceId as string)}`,
        ),
      ),
  },
  {
    name: "remove_admin_access",
    title: "Remove admin access",
    description:
      "Take console access away from an admin device (it stays paired as an ordinary device). There is no way back except pairing a new admin device at the machine.",
    groups: ["admin"],
    ...write,
    destructive: true,
    idempotent: true,
    input: s.object({ deviceId: arg.id("The device id (dev_…).") }, [
      "deviceId",
    ]),
    async confirm(a, d) {
      const dev = await deviceRow(d, a.deviceId as string);
      return { message: `Remove admin access from "${cleanName(dev.name)}"?` };
    },
    run: async (a, d) =>
      json(
        await consoleJson(
          d.client,
          "PATCH",
          `devices/${encodeURIComponent(a.deviceId as string)}`,
          {
            console: false,
          },
        ),
      ),
  },
  {
    name: "narrow_device_scope",
    title: "Narrow a device's scope",
    description:
      "Make a device an agent device, or take permissions or apps away from an agent device. Scopes only narrow; a wider scope needs a new pairing made at the machine.",
    groups: ["admin"],
    ...write,
    destructive: true,
    idempotent: true,
    input: s.object(
      {
        deviceId: arg.id("The device id (dev_…)."),
        perms: s.array(
          "The permissions it keeps.",
          s.enum("A permission.", [
            "data:read",
            "data:write",
            "sharing",
            "devices",
            "console:read",
            "console:write",
          ]),
          6,
        ),
        apps: s.array(
          "The apps it keeps (omit: unchanged / all).",
          arg.app,
          32,
        ),
      },
      ["deviceId", "perms"],
    ),
    async confirm(a, d) {
      const dev = await deviceRow(d, a.deviceId as string);
      return {
        message: `Limit "${cleanName(dev.name)}" to ${(a.perms as string[]).join(", ") || "nothing"}${a.apps ? ` in ${(a.apps as string[]).join(", ")}` : ""}?`,
      };
    },
    run: async (a, d) =>
      json(
        await consoleJson(
          d.client,
          "PATCH",
          `devices/${encodeURIComponent(a.deviceId as string)}`,
          {
            agent: { perms: a.perms, apps: a.apps ?? null },
          },
        ),
      ),
  },
  ...(
    [
      [
        "run_housekeeping",
        "Run housekeeping",
        "housekeeping",
        "Prune expired history, trash, tombstones, pairings and unreferenced blobs now.",
      ],
      [
        "renew_certificate",
        "Renew the certificate",
        "renew-certificate",
        "Renew the ACME certificate now (acme mode only).",
      ],
      [
        "refresh_port_mapping",
        "Refresh port mapping",
        "refresh-port-mapping",
        "Renew the UPnP / NAT-PMP port mapping now.",
      ],
      [
        "create_backup",
        "Back up the server",
        "backup",
        "Write a consistent backup (database and blobs) into the data directory's backups folder.",
      ],
    ] as const
  ).map(([name, title, action, description]): ToolDef => ({
    name,
    title,
    description,
    groups: ["admin"],
    ...write,
    idempotent: true,
    input: empty,
    run: async (_a, d) =>
      json(await consoleJson(d.client, "POST", `actions/${action}`)),
  })),
];
