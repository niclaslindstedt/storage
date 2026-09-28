// The CLI as an admin device (SPEC §11.2): paired with a console pairing,
// signing in with its own key over the device API at /v1/console — the
// way to administer a server from anywhere but its own machine.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createAccount } from "../../server/src/services/accounts.ts";
import { createPairing } from "../../server/src/services/pairing.ts";
import { pairingUri } from "../../server/src/payload.ts";
import { harness, json, shell } from "./helpers.ts";

async function adminDevice() {
  const h = await harness();
  const admin = createAccount(
    h.app.ctx,
    { name: "niclas", role: "admin" },
    "cli",
  );
  const payload = (console: boolean, account = admin.id) =>
    pairingUri({
      server: h.apiUrl,
      code: createPairing(h.app.ctx, { accountId: account, console }, "cli")
        .code!,
      name: "home",
    });
  const sh = shell();
  return { h, admin, payload, sh };
}

describe("admin device login", () => {
  it("pairs, signs in and drives the console over /v1/console", async () => {
    const { h, admin, payload, sh } = await adminDevice();
    const login = await sh(["auth", "login", payload(true)]);
    expect(login.code, login.err).toBe(0);
    expect(login.err).toContain("as admin device dev_");
    const ctx = JSON.parse(
      readFileSync(join(sh.configDir, "config.json"), "utf8"),
    ).contexts.home;
    expect(ctx).toMatchObject({
      url: h.apiUrl,
      account: "niclas",
      auth: { type: "device" },
    });
    expect(ctx.auth.key).toMatch(/^[A-Za-z0-9_-]+$/);

    const devices = json(await sh(["device", "ls", "--json"]));
    expect(devices).toEqual([
      expect.objectContaining({
        id: ctx.auth.deviceId,
        name: "storage CLI on laptop",
        platform: "cli",
        console: true,
      }),
    ]);
    expect((await sh(["account", "create", "kid"])).code).toBe(0);
    // Changes are audited under the device's id.
    const audit = json(
      await sh(["audit", "ls", "--action", "account.create", "--json"]),
    );
    expect(audit[0].actor).toBe(ctx.auth.deviceId);
    expect(json(await sh(["traffic", "--json"]))).toHaveProperty(
      "totals.since",
    );
    expect((await sh(["metrics"])).out).toContain("storage_accounts 2");
    expect(json(await sh(["status", "--json"])).server.name).toBe("home");
    expect((await sh(["account", "pair", "kid", "--no-qr"])).code).toBe(0);
    expect((await sh(["api", "overview"])).code).toBe(0);

    // Remote admin access is granted at the machine only.
    const refused = await sh(["account", "pair", "niclas", "--admin-app"]);
    expect(refused.code).toBe(2);
    expect(refused.err).toContain("paired at the machine");
    const raw = await sh([
      "api",
      `accounts/${admin.id}/pairing`,
      "-F",
      "console=true",
    ]);
    expect(raw.code).toBe(1);
    expect(raw.out).toContain(
      "admin devices are paired from the local console or the CLI",
    );

    const status = json(await sh(["auth", "status", "--json"]));
    expect(status[0]).toMatchObject({
      name: "home",
      current: true,
      auth: "device",
      account: "niclas",
      ok: true,
    });
  });

  it("reuses its access token between runs instead of signing in each time", async () => {
    const { h, payload, sh } = await adminDevice();
    await sh(["auth", "login", payload(true)]);
    const before = h.app.ctx.db.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM tokens",
    )!.n;
    for (let i = 0; i < 5; i++)
      expect((await sh(["account", "ls", "-q"])).code).toBe(0);
    expect(
      h.app.ctx.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM tokens")!.n,
    ).toBe(before);
    // A token the server no longer knows is replaced transparently.
    h.app.ctx.db.run("DELETE FROM tokens");
    expect((await sh(["account", "ls", "-q"])).out).toBe("niclas");
  });

  it("exports a session for scripts and containers", async () => {
    const { payload, sh } = await adminDevice();
    await sh(["auth", "login", payload(true)]);
    const line = (await sh(["auth", "export"])).out;
    expect(line).toMatch(/^STORAGE_SESSION=storage-session-v1\./);
    const ci = shell();
    const r = await ci(["account", "ls", "-q"], {
      env: { STORAGE_SESSION: line.slice("STORAGE_SESSION=".length) },
    });
    expect(r.code, r.err).toBe(0);
    expect(r.out).toBe("niclas");
    expect(
      (await ci(["account", "ls"], { env: { STORAGE_SESSION: "garbage" } }))
        .code,
    ).toBe(4);
    // A bearer for curl.
    expect((await sh(["auth", "token"])).out).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("refuses an ordinary pairing code and takes that device back", async () => {
    const { h, payload, sh } = await adminDevice();
    const r = await sh(["auth", "login", payload(false)]);
    expect(r.code).toBe(4);
    expect(r.err).toContain("not an admin device");
    const live = h.app.ctx.db.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM devices WHERE revoked_at IS NULL",
    )!;
    expect(live.n).toBe(0);
    expect(
      (
        await sh([
          "auth",
          "login",
          payload(true).replace(/c=[^&]+/, "c=" + "x".repeat(43)),
        ])
      ).code,
    ).toBe(4);
  });

  it("stops working when its access is removed, and logout revokes it", async () => {
    const { h, payload, sh } = await adminDevice();
    await sh(["auth", "login", payload(true), "-c", "phone"]);
    await sh(["auth", "login", payload(true), "-c", "laptop"]);
    const ids = json(await sh(["-c", "laptop", "device", "ls", "--json"])).map(
      (d: { id: string }) => d.id,
    );
    expect(ids).toHaveLength(2);
    const phoneId = JSON.parse(
      readFileSync(join(sh.configDir, "config.json"), "utf8"),
    ).contexts.phone.auth.deviceId;
    expect(
      (await sh(["-c", "laptop", "device", "remove-admin", phoneId, "-y"]))
        .code,
    ).toBe(0);
    const denied = await sh(["-c", "phone", "account", "ls"]);
    expect(denied.code).toBe(1);
    expect(denied.err).toContain("only an admin device");
    expect((await sh(["-c", "phone", "auth", "status"])).code).toBe(4);

    const out = await sh(["-c", "laptop", "auth", "logout"]);
    expect(out.code, out.err).toBe(0);
    expect(out.err).toContain("Revoked admin device");
    expect(
      h.app.ctx.db.get<{ n: number }>(
        "SELECT COUNT(*) AS n FROM devices WHERE revoked_at IS NULL",
      )!.n,
    ).toBe(1);
    expect(
      Object.keys(
        JSON.parse(readFileSync(join(sh.configDir, "config.json"), "utf8"))
          .contexts,
      ),
    ).toEqual(["phone"]);
  });

  it("explains a server with the remote console off", async () => {
    const h = await harness({ remoteConsole: false });
    const admin = createAccount(
      h.app.ctx,
      { name: "niclas", role: "admin" },
      "cli",
    );
    const code = createPairing(
      h.app.ctx,
      { accountId: admin.id, console: true },
      "cli",
    ).code!;
    const r = await shell()([
      "auth",
      "login",
      "--url",
      h.apiUrl,
      "--code",
      code,
    ]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("--remote-console off");
  });
});
