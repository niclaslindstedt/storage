// Parity with the admin console and Storage Remote: every console API
// endpoint and every Remote action has a tool (or a stated reason not to),
// and the admin, sharing and device tools work against a real server.

import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it } from "vitest";

import { createStorageServer } from "../../server/src/app.ts";
import { createMemoryLogger } from "../../server/src/log.ts";
import { ALL_TOOLS } from "../src/tools/index.ts";
import { agent, closeAll, drive, home, textOf } from "./helpers.ts";

afterEach(closeAll);

/** Console API endpoint → the tool that covers it. */
const CONSOLE: Record<string, string> = {
  "GET /api/overview": "server_overview",
  "GET /api/metrics": "server_traffic",
  "GET /metrics": "server_traffic",
  "GET /api/accounts": "list_accounts",
  "POST /api/accounts": "create_account",
  "PATCH /api/accounts/:id": "update_account",
  "DELETE /api/accounts/:id": "delete_account",
  "POST /api/accounts/:id/pairing": "create_pairing",
  "POST /api/pairing": "create_pairing",
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
  "sharing: invite": "create_invite",
  "sharing: revoke an invite": "revoke_invite",
  "this phone: waiting devices": "list_pending_devices",
  "this phone: approve (safety code)": "approve_device",
  "this phone: devices": "list_my_devices",
  "this phone: revoke": "revoke_my_device",
  "this phone: add a device by QR": "add_device",
  "this phone: new recovery key": "new_recovery_key",
};

describe("parity", () => {
  it("covers every console API endpoint", async () => {
    const app = createStorageServer({ log: createMemoryLogger(), console: {} });
    const table = (
      app.console!.routes as unknown as {
        table: { method: string; parts: string[] }[];
      }
    ).table;
    const endpoints = table.map((r) => `${r.method} /${r.parts.join("/")}`);
    const names = new Set(ALL_TOOLS.map((t) => t.name));
    for (const e of endpoints) {
      expect(CONSOLE[e], `console endpoint ${e} has no tool`).toBeDefined();
      expect(names.has(CONSOLE[e]!), `${CONSOLE[e]} is not a tool`).toBe(true);
    }
    await app.close();
  });

  it("covers Storage Remote's actions", () => {
    const names = new Set(ALL_TOOLS.map((t) => t.name));
    for (const [action, tool] of Object.entries(REMOTE))
      expect(names.has(tool), action).toBe(true);
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
      if (t.secret)
        expect(
          t.confirm,
          `${t.name} mints a secret without asking`,
        ).toBeDefined();
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

  it("mints a pairing code into the outbox, never into the result", async () => {
    const h = await home();
    const a = await agent(h, { perms: ["console:write"], console: true });
    const r = await a.call(
      "create_pairing",
      {
        accountId: h.account.id,
        agentPerms: ["data:read"],
        agentApps: ["drive"],
      },
      { action: "accept", content: { approve: true } },
    );
    const t = textOf(r);
    expect(t).not.toMatch(/oss-storage:\/\/pair/);
    const file = /written for the person to (\S+) \(QR/.exec(t)![1]!;
    expect(readFileSync(file, "utf8")).toMatch(/oss-storage:\/\/pair\?v=1/);
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
  it("shares a folder: invite (outbox), join, members, removal with rotation", async () => {
    const h = await home();
    const ns = await drive(h.phone, "Family", { "a.md": "a" });
    const a = await agent(h, { perms: ["sharing", "data:write"] });
    const yes = { action: "accept" as const, content: { approve: true } };
    const inv = await a.call(
      "create_invite",
      { namespace: ns.id, role: "editor" },
      yes,
    );
    const file = /written for the person to (\S+) \(QR/.exec(textOf(inv))![1]!;
    const payload = /oss-storage:\/\/invite\S+/.exec(
      readFileSync(file, "utf8"),
    )![0];
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

  it("adds a device by QR and makes a new recovery key, both via the outbox", async () => {
    const h = await home();
    const a = await agent(h, { perms: ["devices", "data:read"] });
    const yes = { action: "accept" as const, content: { approve: true } };
    const add = await a.call("add_device", {}, yes);
    const file = /written for the person to (\S+) \(QR/.exec(textOf(add))![1]!;
    const payload = /oss-storage:\/\/pair\S+/.exec(
      readFileSync(file, "utf8"),
    )![0];
    const { createSelfHostedClient, createMemoryKeyVault } =
      await import("@niclaslindstedt/oss-framework/storage/selfhosted");
    const tablet = createSelfHostedClient({
      vault: createMemoryKeyVault(),
      app: "drive",
    });
    // The code carries the account key, so the new device is ready at once
    // (and, minted by an agent, it is never wider than the agent).
    expect(await tablet.pair(payload, { name: "tablet" })).toBe("ready");
    const rk = await a.call("new_recovery_key", {}, yes);
    expect(textOf(rk)).not.toMatch(/[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}/);
    const rkFile = /written for the person to (\S+)\./.exec(textOf(rk))![1]!;
    const key = readFileSync(rkFile, "utf8").split("\n")[2]!;
    expect(key).not.toBe(h.recoveryKey);
    const devices = await a.call("list_my_devices");
    expect(JSON.stringify(devices.result!.structuredContent)).toContain(
      "tablet",
    );
  });
});
