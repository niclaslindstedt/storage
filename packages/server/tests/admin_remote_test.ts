// The remote console (SPEC §11.2): admin devices reach the admin console's
// API through the device API at /v1/console, with device tokens — and
// nobody else does.

import { afterEach, describe, expect, it } from "vitest";

import { createStorageServer, type StorageServer } from "../src/app.ts";
import type { ConfigOverrides } from "../src/config.ts";
import { createMemoryLogger } from "../src/log.ts";
import { createAccount } from "../src/services/accounts.ts";
import { createPairing } from "../src/services/pairing.ts";
import { deviceKeys, signChallenge } from "./helpers.ts";

const open: StorageServer[] = [];
afterEach(async () => {
  for (const s of open.splice(0)) await s.close();
});

async function server(config: ConfigOverrides = {}) {
  const app = createStorageServer({
    log: createMemoryLogger(),
    config: { name: "home", tls: { mode: "off" }, ...config },
    console: {},
  });
  const url = await app.listen(0);
  open.push(app);
  return { app, url };
}

/** Redeem a pairing code over HTTP and sign in; returns a fetch with the token. */
async function device(url: string, code: string) {
  const keys = await deviceKeys();
  const post = (path: string, body: unknown) =>
    fetch(url + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  const paired = await post("/v1/pair", {
    code,
    device: {
      name: "phone",
      platform: "ios",
      dskPublic: keys.dskPublic,
      dekPublic: keys.dekPublic,
    },
  });
  expect(paired.status).toBe(201);
  const p = (await paired.json()) as {
    deviceId: string;
    serverId: string;
    console: boolean;
  };
  const { challenge } = (await (
    await post("/v1/auth/challenge", { deviceId: p.deviceId })
  ).json()) as { challenge: string };
  const { token } = (await (
    await post("/v1/auth/token", {
      deviceId: p.deviceId,
      challenge,
      signature: await signChallenge(keys, p.serverId, p.deviceId, challenge),
    })
  ).json()) as { token: string };
  const call = (path: string, init: RequestInit = {}) =>
    fetch(url + path, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
    });
  return { deviceId: p.deviceId, console: p.console, call };
}

function pairing(app: StorageServer, accountId: string, console: boolean) {
  return createPairing(app.ctx, { accountId, console }, "cli").code!;
}

describe("admin device pairing", () => {
  it("enrols an admin device only for an admin account", async () => {
    const { app } = await server();
    const member = createAccount(app.ctx, { name: "kid", role: "member" });
    expect(() => pairing(app, member.id, true)).toThrow(/admin account/);
  });

  it("marks the device and reports it on /v1/me and in the console", async () => {
    const { app, url } = await server();
    const acc = createAccount(app.ctx, { name: "niclas", role: "admin" });
    const phone = await device(url, pairing(app, acc.id, true));
    expect(phone.console).toBe(true);
    const me = (await (await phone.call("/v1/me")).json()) as {
      console: boolean;
    };
    expect(me.console).toBe(true);
    const devices = (await (
      await phone.call("/v1/console/devices")
    ).json()) as { id: string; console: boolean }[];
    expect(devices.find((d) => d.id === phone.deviceId)?.console).toBe(true);
  });

  it("never lets a device mint an admin device pairing", async () => {
    const { app, url } = await server();
    const acc = createAccount(app.ctx, { name: "niclas", role: "admin" });
    const phone = await device(url, pairing(app, acc.id, true));
    const viaDeviceApi = await phone.call("/v1/pairings", {
      method: "POST",
      body: JSON.stringify({ accountId: acc.id, console: true }),
    });
    expect(viaDeviceApi.status).toBe(403);
    const viaConsole = await phone.call(
      `/v1/console/accounts/${acc.id}/pairing`,
      { method: "POST", body: JSON.stringify({ console: true }) },
    );
    expect(viaConsole.status).toBe(403);
    // …but an ordinary device pairing (to show a family member a QR) is fine.
    const ordinary = await phone.call(
      `/v1/console/accounts/${acc.id}/pairing`,
      { method: "POST", body: JSON.stringify({}) },
    );
    expect(ordinary.status).toBe(200);
    expect(((await ordinary.json()) as { payload: string }).payload).toMatch(
      /^oss-storage:\/\/pair\?/,
    );
  });
});

describe("/v1/console", () => {
  it("refuses ordinary devices, members and anonymous callers", async () => {
    const { app, url } = await server();
    const admin = createAccount(app.ctx, { name: "niclas", role: "admin" });
    const member = createAccount(app.ctx, { name: "kid", role: "member" });
    const laptop = await device(url, pairing(app, admin.id, false));
    const kid = await device(url, pairing(app, member.id, false));
    expect((await laptop.call("/v1/console/overview")).status).toBe(403);
    expect((await kid.call("/v1/console/overview")).status).toBe(403);
    expect((await fetch(`${url}/v1/console/overview`)).status).toBe(401);
  });

  it("serves the console API to an admin device", async () => {
    const { app, url } = await server();
    const acc = createAccount(app.ctx, { name: "niclas", role: "admin" });
    const phone = await device(url, pairing(app, acc.id, true));
    const overview = (await (
      await phone.call("/v1/console/overview")
    ).json()) as { server: { name: string }; counts: { accounts: number } };
    expect(overview.server.name).toBe("home");
    expect(overview.counts.accounts).toBe(1);
    const metrics = await phone.call("/v1/console/metrics");
    expect(metrics.headers.get("content-type")).toMatch(/^text\/plain/);
    expect(await metrics.text()).toContain("storage_accounts 1");
    expect((await phone.call("/v1/console/nope")).status).toBe(404);
    expect(
      (await phone.call("/v1/console/overview", { method: "DELETE" })).status,
    ).toBe(405);
  });

  it("streams the live log and serves downloads to an admin device", async () => {
    const { app, url } = await server();
    const acc = createAccount(app.ctx, { name: "niclas", role: "admin" });
    const phone = await device(url, pairing(app, acc.id, true));
    const res = await phone.call("/v1/console/logs/stream?after=0", {
      headers: { Accept: "text/event-stream" },
    });
    expect(res.headers.get("content-type")).toMatch(/^text\/event-stream/);
    const reader = res.body!.getReader();
    // Something to log: a change made from the phone.
    await phone.call("/v1/console/accounts", {
      method: "POST",
      body: JSON.stringify({ name: "kid", role: "member" }),
    });
    let text = "";
    while (!text.includes("created member account")) {
      const { value, done } = await reader.read();
      if (done) break;
      text += new TextDecoder().decode(value);
    }
    await reader.cancel();
    expect(text).toContain("event: log");
    expect(text).toContain(`(remote, ${phone.deviceId})`);

    const bundle = await phone.call("/v1/console/diagnostics");
    expect(bundle.headers.get("content-disposition")).toMatch(
      /attachment; filename="storage-diagnostics-/,
    );
    expect(
      ((await bundle.json()) as { overview: { server: { name: string } } })
        .overview.server.name,
    ).toBe("home");
  });

  it("adds a user and audits it under the admin device", async () => {
    const { app, url } = await server();
    const acc = createAccount(app.ctx, { name: "niclas", role: "admin" });
    const phone = await device(url, pairing(app, acc.id, true));
    const created = await phone.call("/v1/console/accounts", {
      method: "POST",
      body: JSON.stringify({ name: "grandma", role: "member" }),
    });
    expect(created.status).toBe(201);
    const audit = (await (
      await phone.call("/v1/console/audit?action=account")
    ).json()) as { entries: { actor: string; action: string }[] };
    expect(audit.entries[0]).toMatchObject({
      actor: phone.deviceId,
      action: "account.create",
    });
  });

  it("stops at once when the device loses console access or the account its role", async () => {
    const { app, url } = await server();
    const acc = createAccount(app.ctx, { name: "niclas", role: "admin" });
    const other = createAccount(app.ctx, { name: "partner", role: "admin" });
    const phone = await device(url, pairing(app, acc.id, true));
    const tablet = await device(url, pairing(app, other.id, true));

    const dropped = await phone.call(`/v1/console/devices/${tablet.deviceId}`, {
      method: "PATCH",
      body: JSON.stringify({ console: false }),
    });
    expect(dropped.status).toBe(200);
    expect((await tablet.call("/v1/console/overview")).status).toBe(403);
    // It stays paired as an ordinary device.
    expect((await tablet.call("/v1/me")).status).toBe(200);
    // And cannot be granted again.
    const regrant = await phone.call(`/v1/console/devices/${tablet.deviceId}`, {
      method: "PATCH",
      body: JSON.stringify({ console: true }),
    });
    expect(regrant.status).toBe(400);

    // An admin device is an admin device only while its account is an admin.
    const laptop = await device(url, pairing(app, other.id, true));
    expect((await laptop.call("/v1/console/overview")).status).toBe(200);
    const demote = await phone.call(`/v1/console/accounts/${other.id}`, {
      method: "PATCH",
      body: JSON.stringify({ role: "member" }),
    });
    expect(demote.status).toBe(200);
    expect((await laptop.call("/v1/console/overview")).status).toBe(403);
    const me = (await (await laptop.call("/v1/me")).json()) as {
      console: boolean;
    };
    expect(me.console).toBe(false);
  });

  it("is off with remoteConsole: false, and /v1/info says so", async () => {
    const on = await server();
    const info = (await (await fetch(`${on.url}/v1/info`)).json()) as {
      capabilities: string[];
    };
    expect(info.capabilities).toContain("console");

    const { app, url } = await server({ remoteConsole: false });
    const offInfo = (await (await fetch(`${url}/v1/info`)).json()) as {
      capabilities: string[];
    };
    expect(offInfo.capabilities).not.toContain("console");
    const acc = createAccount(app.ctx, { name: "niclas", role: "admin" });
    const phone = await device(url, pairing(app, acc.id, true));
    expect((await phone.call("/v1/console/overview")).status).toBe(404);
  });
});
