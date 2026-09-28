// Parity with the admin console and Storage Remote: every console API
// endpoint and every Remote action is covered — by a tool, or, where it
// hands out keys or credentials, by a command a person runs at a terminal
// (`storage-mcp …`, or the headless `storage` CLI) — and the admin,
// sharing and device tools work against a real server.

import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it } from "vitest";

import { createStorageServer } from "../../server/src/app.ts";
import { createMemoryLogger } from "../../server/src/log.ts";
import { PERSON_COMMANDS } from "../src/person.ts";
import { ALL_TOOLS } from "../src/tools/index.ts";
import { agent, closeAll, drive, home, textOf } from "./helpers.ts";

afterEach(closeAll);

/**
 * Console API endpoint → what covers it: a tool name, `person:<storage-mcp
 * command>` or `cli:<storage command>` for what only a person may do.
 */
const CONSOLE: Record<string, string> = {
  "GET /api/overview": "server_overview",
  "GET /api/metrics": "server_traffic",
  "GET /metrics": "server_traffic",
  "GET /api/accounts": "list_accounts",
  "POST /api/accounts": "create_account",
  "PATCH /api/accounts/:id": "update_account",
  "DELETE /api/accounts/:id": "delete_account",
  "POST /api/accounts/:id/pairing": "cli:account pair",
  "POST /api/pairing": "cli:account pair",
  "GET /api/devices": "list_all_devices",
  "PATCH /api/devices/:id": "remove_admin_access",
  "DELETE /api/devices/:id": "revoke_device",
  "GET /api/namespaces": "list_all_namespaces",
  "GET /api/logs": "read_logs",
  // The live tail is a stream for a screen; an agent pages with read_logs.
  "GET /api/logs/stream": "read_logs",
  "GET /api/logs/file": "read_debug_log",
  "GET /api/audit": "read_audit_log",
  "POST /api/audit/verify": "verify_audit_chain",
  "GET /api/checks": "server_checks",
  "GET /api/config": "server_config",
  "POST /api/actions/housekeeping": "run_housekeeping",
  "POST /api/actions/renew-certificate": "renew_certificate",
  "POST /api/actions/refresh-port-mapping": "refresh_port_mapping",
  "POST /api/actions/backup": "create_backup",
  "GET /api/diagnostics": "diagnostics_bundle",
};

/** Storage Remote's actions (apps/remote/src) → tools. */
const REMOTE: Record<string, string> = {
  "files: list shared folders": "list_namespaces",
  "files: new folder": "create_namespace",
  "files: join an invite": "join_shared_folder",
  "files: delete / leave a folder": "delete_namespace",
  "files: leave a folder": "leave_namespace",
  "files: browse": "list_files",
  "files: upload": "write_file",
  "files: save / open": "read_file",
  "files: new subfolder": "make_folder",
  "files: rename / move": "move",
  "files: delete": "delete_file",
  "files: versions": "file_history",
  "files: restore a version": "restore_file_version",
  "files: trash": "list_trash",
  "files: restore from trash": "restore_from_trash",
  "files: delete for good": "purge_from_trash",
  "sharing: members": "list_members",
  "sharing: remove a member (rotate)": "remove_member",
  "sharing: invites": "list_invites",
  "sharing: invite": "person:invite",
  "sharing: revoke an invite": "revoke_invite",
  "this phone: waiting devices": "list_pending_devices",
  "this phone: approve (safety code)": "person:device approve",
  "this phone: devices": "list_my_devices",
  "this phone: revoke": "revoke_my_device",
  "this phone: add a device by QR": "person:device add",
  "this phone: new recovery key": "person:recovery-key",
};

/** Whether a tool, a person command or a headless CLI command covers it. */
function covered(what: string): boolean {
  if (what.startsWith("person:"))
    return (PERSON_COMMANDS as readonly string[]).includes(what.slice(7));
  if (what.startsWith("cli:")) {
    const [cmd, sub] = what.slice(4).split(" ");
    return readFileSync(
      new URL(`../../../man/storage/${cmd}.md`, import.meta.url),
      "utf8",
    ).includes(`### ${sub}`);
  }
  return ALL_TOOLS.some((t) => t.name === what);
}

describe("parity", () => {
  it("covers every console API endpoint", async () => {
    const app = createStorageServer({ log: createMemoryLogger(), console: {} });
    const table = (
      app.console!.routes as unknown as {
        table: { method: string; parts: string[] }[];
      }
    ).table;
    const endpoints = table.map((r) => `${r.method} /${r.parts.join("/")}`);
    for (const e of endpoints) {
      expect(CONSOLE[e], `console endpoint ${e} has no tool`).toBeDefined();
      expect(covered(CONSOLE[e]!), `${CONSOLE[e]} does not exist`).toBe(true);
    }
    await app.close();
  });

  it("covers Storage Remote's actions", () => {
    for (const [action, what] of Object.entries(REMOTE))
      expect(covered(what), action).toBe(true);
    // The framework calls the Remote app makes are the ones the tools make.
    const remote = [
      "files/browser.ts",
      "files/drives.ts",
      "files/share.ts",
      "device.ts",
    ]
      .map((f) =>
        readFileSync(
          new URL(`../../../apps/remote/src/${f}`, import.meta.url),
          "utf8",
        ),
      )
      .join("\n");
    for (const call of [
      "files.write",
      "files.move",
      "files.delete",
      "files.history",
      "files.restore",
      "restoreTrash",
      "purgeTrash",
      "invite(",
      "removeMember",
      "revokeInvite",
      "approveDevice",
      "addDevicePayload",
      "regenerateRecoveryKey",
      "revokeDevice",
      "acceptInvite",
      "createNamespace",
    ])
      expect(remote.includes(call), call).toBe(true);
  });

  it("names tools per the MCP rules, uniquely, with closed schemas", () => {
    const names = ALL_TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const t of ALL_TOOLS) {
      expect(t.name).toMatch(/^[a-z][a-z0-9_]{0,63}$/);
      expect(t.input.additionalProperties).toBe(false);
      expect(t.description.length).toBeGreaterThan(20);
    }
  });
});

describe("admin tools", () => {
  it("create, change and delete accounts, each confirmed by the person", async () => {
    const h = await home();
    const a = await agent(h, { perms: ["console:write"], console: true });
    const yes = { action: "accept" as const, content: { approve: true } };
    const created = await a.call(
      "create_account",
      { name: "grandma", role: "member" },
      yes,
    );
    const id = (created.result!.structuredContent as { id: string }).id;
    expect((created as { asked?: string }).asked).toMatch(
      /Create the member account "grandma"/,
    );
    await a.call("update_account", { accountId: id, disabled: true }, yes);
    const listed = await a.call("list_accounts");
    expect(JSON.stringify(listed.result!.structuredContent)).toMatch(
      /"disabled/,
    );
    const del = await a.call(
      "delete_account",
      { accountId: id },
      { action: "accept", content: { confirm: "grandma" } },
    );
    expect(del.result!.isError).toBeUndefined();
  });

  it("narrows another device's scope and runs maintenance", async () => {
    const h = await home();
    const a = await agent(h, { perms: ["console:write"], console: true });
    const other = await agent(h, { perms: ["data:write"] });
    const r = await a.call(
      "narrow_device_scope",
      { deviceId: other.session.me.deviceId, perms: ["data:read"] },
      { action: "accept", content: { approve: true } },
    );
    expect(r.result!.structuredContent).toMatchObject({
      agent: { perms: ["data:read"] },
    });
    const hk = await a.call("run_housekeeping");
    expect(hk.result!.isError).toBeUndefined();
    const self = await a.call(
      "revoke_device",
      { deviceId: a.session.me.deviceId },
      { action: "accept", content: { approve: true } },
    );
    expect(textOf(self)).toMatch(/agent's own device/);
  });
});

describe("sharing and devices", () => {
  it("shares a folder: invites, join, members, removal with rotation", async () => {
    const h = await home();
    const ns = await drive(h.phone, "Family", { "a.md": "a" });
    const a = await agent(h, { perms: ["sharing", "data:write"] });
    const yes = { action: "accept" as const, content: { approve: true } };
    // A person makes the invite (Storage Remote, or `storage-mcp invite`).
    const { payload } = await ns.invite({ role: "editor" });
    const joiner = await agent(h, { perms: ["sharing", "data:read"] });
    const listedInvites = await a.call("list_invites", { namespace: ns.id });
    expect(
      (listedInvites.result!.structuredContent as { invites: unknown[] })
        .invites.length,
    ).toBe(1);
    // Someone else redeems it: a new guest account.
    const { createSelfHostedClient, createMemoryKeyVault } =
      await import("@niclaslindstedt/oss-framework/storage/selfhosted");
    const guest = createSelfHostedClient({
      vault: createMemoryKeyVault(),
      app: "drive",
    });
    await guest.acceptInvite(payload, {
      accountName: "guest",
      device: { name: "guest phone" },
    });
    const members = await a.call("list_members", { namespace: ns.id });
    const g = (
      members.result!.structuredContent as {
        members: { accountId: string; name: string }[];
      }
    ).members.find((m) => m.name === "guest")!;
    expect(g).toBeDefined();
    const removed = await a.call(
      "remove_member",
      { namespace: ns.id, accountId: g.accountId },
      yes,
    );
    expect(removed.result!.structuredContent).toMatchObject({ rotated: true });
    expect((await h.phone.namespace(ns.id)).epoch).toBe(2);
    expect(await joiner.tools()).toContain("join_shared_folder");
    const foreign = await joiner.call(
      "join_shared_folder",
      { invite: payload.replace(/s=[^&]+/, "s=https%3A%2F%2Fevil.example") },
      yes,
    );
    expect(textOf(foreign)).toMatch(/another server/);
  });
});
