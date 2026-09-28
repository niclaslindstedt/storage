// Agent devices (SPEC §11.4): a pairing may carry a scope — permissions and
// apps — that the server holds the device to on every request. Scopes are
// minted at the machine (console, CLI) or narrowed from a wider device,
// never widened.

import { afterEach, describe, expect, it } from "vitest";

import { createStorageServer, type StorageServer } from "../src/app.ts";
import { ApiError } from "../src/errors.ts";
import { createMemoryLogger } from "../src/log.ts";
import { createAccount } from "../src/services/accounts.ts";
import { createPairing } from "../src/services/pairing.ts";
import {
  type AgentScope,
  intersect,
  isWithin,
  parseScope,
  readScope,
  routePermission,
  SCOPED_ROUTES,
} from "../src/services/scope.ts";
import {
  deviceKeys,
  envelope,
  envelopeB64u,
  signChallenge,
  WRAP,
} from "./helpers.ts";

const open: StorageServer[] = [];
afterEach(async () => {
  for (const s of open.splice(0)) await s.close();
});

async function server() {
  const app = createStorageServer({
    log: createMemoryLogger(),
    config: { name: "home", tls: { mode: "off" } },
    console: {},
  });
  const url = await app.listen(0);
  open.push(app);
  return { app, url };
}

type Device = {
  deviceId: string;
  accountId: string;
  keys: Awaited<ReturnType<typeof deviceKeys>>;
  call: (path: string, init?: RequestInit) => Promise<Response>;
};

/** Redeem a pairing code over HTTP and sign in. */
async function device(url: string, code: string): Promise<Device> {
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
      name: "agent",
      platform: "mcp",
      dskPublic: keys.dskPublic,
      dekPublic: keys.dekPublic,
    },
  });
  expect(paired.status).toBe(201);
  const p = (await paired.json()) as {
    deviceId: string;
    accountId: string;
    serverId: string;
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
        ...(typeof init.body === "string"
          ? { "Content-Type": "application/json" }
          : {}),
        ...init.headers,
      },
    });
  return { deviceId: p.deviceId, accountId: p.accountId, keys, call };
}

/** Call the local console's API in process, as the console listener would. */
async function local(
  app: StorageServer,
  method: string,
  path: string,
  body: unknown = {},
): Promise<{ status: number; json: unknown }> {
  const m = app.console!.routes.match(method, path);
  if (!m || "methods" in m) throw new Error(`no route ${method} ${path}`);
  try {
    const out = await m.handler({
      params: m.params,
      query: new URLSearchParams(),
      ip: "127.0.0.1",
      actor: "admin-console",
      remote: false,
      scope: null,
      body: async () => body as Record<string, unknown>,
    });
    return { status: out.status ?? 200, json: out.json };
  } catch (err) {
    if (err instanceof ApiError) return { status: err.status, json: null };
    throw err;
  }
}

const json = (body: unknown) => ({
  method: "POST",
  body: JSON.stringify(body),
});

function code(
  app: StorageServer,
  accountId: string,
  scope?: AgentScope,
  console = false,
) {
  return createPairing(app.ctx, { accountId, scope, console }, "cli").code!;
}

async function createNs(d: Device, app: string): Promise<Response> {
  return d.call(
    "/v1/namespaces",
    json({ app, meta: envelopeB64u(1), wrap: WRAP }),
  );
}

/** An account with an unscoped device (keys set up) and two namespaces. */
async function household(url: string, app: StorageServer) {
  const acc = createAccount(app.ctx, { name: "niclas", role: "admin" });
  const phone = await device(url, code(app, acc.id));
  const keys = await phone.call("/v1/me/keys", {
    method: "PUT",
    body: JSON.stringify({
      aekPublic: phone.keys.dekPublic,
      recoveryWrap: WRAP,
      deviceWraps: { [phone.deviceId]: WRAP },
    }),
  });
  expect(keys.status).toBe(200);
  const drive = (await (await createNs(phone, "drive")).json()) as {
    id: string;
  };
  const meds = (await (await createNs(phone, "meds")).json()) as {
    id: string;
  };
  const put = await phone.call(`/v1/ns/${drive.id}/files/a`, {
    method: "PUT",
    body: envelope(1),
    headers: {
      "Content-Type": "application/octet-stream",
      "X-Meta": envelopeB64u(1),
    },
  });
  expect(put.status).toBe(200);
  return { acc, phone, drive: drive.id, meds: meds.id };
}

describe("scope model", () => {
  it("normalizes: writes imply reads, sorted, deduplicated", () => {
    expect(parseScope({ perms: ["data:write", "console:write"] })).toEqual({
      perms: ["data:read", "data:write", "console:read", "console:write"],
      apps: null,
    });
    expect(
      parseScope({ perms: ["sharing"], apps: ["notes", "drive", "notes"] }),
    ).toEqual({ perms: ["data:read", "sharing"], apps: ["drive", "notes"] });
    expect(parseScope({}).perms).toEqual(["data:read"]);
  });

  it("rejects unknown permissions, fields and app ids", () => {
    expect(() => parseScope({ perms: ["root"] })).toThrow(/unknown permission/);
    expect(() => parseScope({ perms: [], extra: 1 })).toThrow(
      /not a scope field/,
    );
    expect(() => parseScope({ apps: ["../x"] })).toThrow(/invalid app id/);
    expect(() => parseScope({ apps: [] })).toThrow(/1-32 app ids/);
  });

  it("a corrupt stored scope grants nothing rather than everything", () => {
    expect(readScope("{not json")).toEqual({ perms: [], apps: [] });
    expect(readScope(null)).toBeNull();
  });

  it("orders scopes: narrower is within, intersection is the overlap", () => {
    const wide = parseScope({ perms: ["data:write"], apps: null });
    const narrow = parseScope({ perms: ["data:read"], apps: ["drive"] });
    expect(isWithin(narrow, wide)).toBe(true);
    expect(isWithin(wide, narrow)).toBe(false);
    expect(isWithin(wide, null)).toBe(true);
    expect(intersect(wide, narrow)).toEqual(narrow);
  });

  it("classifies every authenticated device-API route (fail closed)", async () => {
    const { app } = await server();
    const unlisted = app.router.routes
      .filter((r) => r.auth !== "none" && !r.pattern.startsWith("/__test"))
      .map((r) => `${r.method} ${r.pattern}`)
      .filter((k) => !SCOPED_ROUTES.includes(k));
    expect(unlisted).toEqual([]);
    expect(
      routePermission("POST", "/v1/console/*rest", { rest: "audit/verify" }),
    ).toBe("console:read");
    expect(routePermission("GET", "/v1/nope", {})).toBeNull();
  });
});

describe("agent devices", () => {
  it("reports the scope on /v1/me and in the console", async () => {
    const { app, url } = await server();
    const acc = createAccount(app.ctx, { name: "niclas", role: "member" });
    const agent = await device(
      url,
      code(app, acc.id, parseScope({ apps: ["drive"] })),
    );
    const me = (await (await agent.call("/v1/me")).json()) as {
      agent: AgentScope;
    };
    expect(me.agent).toEqual({ perms: ["data:read"], apps: ["drive"] });
    const audit = app.ctx.db.get<{ detail: string }>(
      "SELECT detail FROM audit WHERE action = 'device.pair' ORDER BY id DESC",
    );
    expect(JSON.parse(audit!.detail).agent.apps).toEqual(["drive"]);
  });

  it("holds a read-only agent to reads", async () => {
    const { app, url } = await server();
    const { acc, drive } = await household(url, app);
    const agent = await device(url, code(app, acc.id, parseScope({})));
    expect((await agent.call(`/v1/ns/${drive}/files`)).status).toBe(200);
    expect((await agent.call(`/v1/ns/${drive}/files/a`)).status).toBe(200);
    const write = await agent.call(`/v1/ns/${drive}/files/b`, {
      method: "PUT",
      body: envelope(1),
      headers: {
        "Content-Type": "application/octet-stream",
        "X-Meta": envelopeB64u(1),
      },
    });
    expect(write.status).toBe(403);
    expect(
      ((await write.json()) as { error: { message: string } }).error.message,
    ).toMatch(/data:write/);
    expect((await createNs(agent, "drive")).status).toBe(403);
    expect(
      (await agent.call(`/v1/ns/${drive}/files/a`, { method: "DELETE" }))
        .status,
    ).toBe(403);
    // Not its business: devices, pairings, sharing, the console.
    expect((await agent.call("/v1/me/devices")).status).toBe(403);
    expect((await agent.call("/v1/me/pending-devices")).status).toBe(403);
    expect(
      (await agent.call("/v1/pairings", json({ accountId: acc.id }))).status,
    ).toBe(403);
    expect((await agent.call(`/v1/namespaces/${drive}/invites`)).status).toBe(
      403,
    );
    expect((await agent.call("/v1/admin/accounts")).status).toBe(403);
    expect((await agent.call("/v1/console/overview")).status).toBe(403);
    // The account is an admin's, so an unscoped device could do all of that.
  });

  it("may always revoke itself, never another device, without devices", async () => {
    const { app, url } = await server();
    const { acc, phone } = await household(url, app);
    const agent = await device(url, code(app, acc.id, parseScope({})));
    const del = (id: string) =>
      agent.call(`/v1/devices/${id}`, { method: "DELETE" });
    expect((await del(phone.deviceId)).status).toBe(403);
    expect((await del(agent.deviceId)).status).toBe(204);
    expect((await agent.call("/v1/me")).status).toBe(401);
  });

  it("sees only the apps it was given", async () => {
    const { app, url } = await server();
    const { acc, drive, meds } = await household(url, app);
    const agent = await device(
      url,
      code(app, acc.id, parseScope({ perms: ["data:write"], apps: ["drive"] })),
    );
    const { namespaces: list } = (await (
      await agent.call("/v1/namespaces")
    ).json()) as { namespaces: { id: string }[] };
    expect(list.map((n) => n.id)).toEqual([drive]);
    expect((await agent.call(`/v1/namespaces/${meds}`)).status).toBe(404);
    expect((await agent.call(`/v1/ns/${meds}/files`)).status).toBe(404);
    expect((await agent.call(`/v1/ns/${meds}/changes`)).status).toBe(404);
    expect((await createNs(agent, "meds")).status).toBe(403);
    expect((await createNs(agent, "drive")).status).toBe(201);
  });

  it("stores its own first key copy, nothing more, without devices", async () => {
    const { app, url } = await server();
    const { acc, phone } = await household(url, app);
    const agent = await device(url, code(app, acc.id, parseScope({})));
    const put = (body: unknown) =>
      agent.call("/v1/me/keys", { method: "PUT", body: JSON.stringify(body) });
    // Hand the key to another device, replace the recovery key: refused.
    expect(
      (await put({ deviceWraps: { [phone.deviceId]: WRAP } })).status,
    ).toBe(403);
    expect((await put({ recoveryWrap: WRAP })).status).toBe(403);
    // Its own copy (after recovery / approval): once.
    expect(
      (await put({ deviceWraps: { [agent.deviceId]: WRAP } })).status,
    ).toBe(200);
    expect(
      (await put({ deviceWraps: { [agent.deviceId]: WRAP } })).status,
    ).toBe(403);
  });

  it("mints pairings only for its own account, never wider than itself", async () => {
    const { app, url } = await server();
    const { acc } = await household(url, app);
    const other = createAccount(app.ctx, { name: "kid", role: "member" });
    const agent = await device(
      url,
      code(
        app,
        acc.id,
        parseScope({ perms: ["devices", "data:read"], apps: ["drive"] }),
      ),
    );
    expect(
      (await agent.call("/v1/pairings", json({ accountId: other.id }))).status,
    ).toBe(403);
    expect(
      (
        await agent.call(
          "/v1/pairings",
          json({ newAccount: { name: "x", role: "member" } }),
        )
      ).status,
    ).toBe(403);
    const minted = await agent.call(
      "/v1/pairings",
      json({ accountId: acc.id, agent: { perms: ["data:write"] } }),
    );
    expect(minted.status).toBe(201);
    const { code: c } = (await minted.json()) as { code: string };
    const child = await device(url, c);
    const me = (await (await child.call("/v1/me")).json()) as {
      agent: AgentScope;
    };
    // data:write was not the parent's to give; the apps limit carries over.
    expect(me.agent).toEqual({ perms: ["data:read"], apps: ["drive"] });
  });

  it("an ordinary device may pair a narrower agent through the device API", async () => {
    const { app, url } = await server();
    const { acc, phone } = await household(url, app);
    const r = await phone.call(
      "/v1/pairings",
      json({
        accountId: acc.id,
        agent: { perms: ["data:read"], apps: ["drive"] },
      }),
    );
    expect(r.status).toBe(201);
    const agent = await device(
      url,
      ((await r.json()) as { code: string }).code,
    );
    expect((await createNs(agent, "drive")).status).toBe(403);
    // …but console permissions need a console pairing, made at the machine.
    const bad = await phone.call(
      "/v1/pairings",
      json({ accountId: acc.id, agent: { perms: ["console:read"] } }),
    );
    expect(bad.status).toBe(400);
  });

  it("gives an agent admin device only the console access in its scope", async () => {
    const { app, url } = await server();
    const acc = createAccount(app.ctx, { name: "niclas", role: "admin" });
    const agent = await device(
      url,
      code(app, acc.id, parseScope({ perms: ["console:read"] }), true),
    );
    expect((await agent.call("/v1/console/overview")).status).toBe(200);
    expect((await agent.call("/v1/console/devices")).status).toBe(200);
    expect(
      (await agent.call("/v1/console/audit/verify", { method: "POST" })).status,
    ).toBe(200);
    expect(
      (await agent.call("/v1/console/accounts", json({ name: "x" }))).status,
    ).toBe(403);
    expect(
      (await agent.call("/v1/console/actions/housekeeping", { method: "POST" }))
        .status,
    ).toBe(403);
    // No data permission: its own account's namespaces are off limits.
    expect((await agent.call("/v1/namespaces")).status).toBe(403);
  });

  it("an agent admin device's console pairings inherit its scope", async () => {
    const { app, url } = await server();
    const acc = createAccount(app.ctx, { name: "niclas", role: "admin" });
    const agent = await device(
      url,
      code(
        app,
        acc.id,
        parseScope({ perms: ["console:write", "data:read"], apps: ["drive"] }),
        true,
      ),
    );
    const r = await agent.call(
      `/v1/console/accounts/${acc.id}/pairing`,
      json({}),
    );
    expect(r.status).toBe(200);
    const payload = ((await r.json()) as { payload: string }).payload;
    const c = new URL(payload).searchParams.get("c")!;
    const child = await device(url, c);
    const me = (await (await child.call("/v1/me")).json()) as {
      agent: AgentScope;
      console: boolean;
    };
    expect(me.console).toBe(false);
    expect(me.agent).toEqual({ perms: ["data:read"], apps: ["drive"] });
  });

  it("narrows a scope from the console, never widens it", async () => {
    const { app, url } = await server();
    const { acc, phone, drive } = await household(url, app);
    const agent = await device(
      url,
      code(app, acc.id, parseScope({ perms: ["data:write"] })),
    );
    const token = app.ctx.db.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM tokens WHERE device_id = ?",
      agent.deviceId,
    );
    expect(token!.n).toBe(1);
    const patch = (id: string, body: unknown) =>
      local(app, "PATCH", `/api/devices/${id}`, body);
    const wider = await patch(agent.deviceId, {
      agent: { perms: ["sharing"] },
    });
    expect(wider.status).toBe(403);
    const narrower = await patch(agent.deviceId, {
      agent: { perms: ["data:read"], apps: ["drive"] },
    });
    expect(narrower.status).toBe(200);
    expect(narrower.json).toMatchObject({
      agent: { perms: ["data:read"], apps: ["drive"] },
    });
    // Its token died with the change; the scope applies from the next sign-in.
    expect((await agent.call(`/v1/ns/${drive}/files`)).status).toBe(401);
    // An ordinary device can be turned into an agent the same way.
    expect((await patch(phone.deviceId, { agent: {} })).status).toBe(200);
    expect((await patch(phone.deviceId, { name: "x" })).status).toBe(400);
    const listed = (await local(app, "GET", "/api/devices")).json as {
      id: string;
      agent: AgentScope | null;
    }[];
    expect(listed.find((d) => d.id === phone.deviceId)?.agent).toEqual({
      perms: ["data:read"],
      apps: null,
    });
  });

  it("refuses console permissions without a console pairing", async () => {
    const { app } = await server();
    const acc = createAccount(app.ctx, { name: "niclas", role: "admin" });
    expect(() =>
      code(app, acc.id, parseScope({ perms: ["console:read"] }), false),
    ).toThrow(/console/);
  });
});
