// The admin console over real HTTP: authentication, browser guards, and the
// JSON API the UI drives (SPEC §11.1).

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { type AdminConsole, startAdminConsole } from "../src/admin/console.ts";
import { LogBuffer, teeLogger } from "../src/admin/log-buffer.ts";
import { Metrics } from "../src/admin/metrics.ts";
import { createStorageServer, type StorageServer } from "../src/app.ts";
import { createMemoryLogger } from "../src/log.ts";
import { createAccount } from "../src/services/accounts.ts";
import { insertDevice } from "../src/services/devices.ts";
import { deviceKeys } from "./helpers.ts";

type Harness = {
  app: StorageServer;
  admin: AdminConsole;
  apiUrl: string;
  logs: LogBuffer;
  /** fetch against the console with the bearer token. */
  api(path: string, init?: RequestInit): Promise<Response>;
  json<T = any>(path: string, init?: RequestInit): Promise<T>; // eslint-disable-line @typescript-eslint/no-explicit-any
};

const open: { close(): Promise<void> }[] = [];
const dirs: string[] = [];
afterEach(async () => {
  for (const o of open.splice(0).reverse()) await o.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

async function harness(opts: { dataDir?: string } = {}): Promise<Harness> {
  const logs = new LogBuffer();
  const log = teeLogger(createMemoryLogger(), logs);
  const metrics = new Metrics({ now: () => Date.now() });
  const app = createStorageServer({
    log,
    metrics,
    config: {
      name: "home",
      dataDir: opts.dataDir ?? null,
      tls: { mode: "off" },
      listen: { host: "127.0.0.1" },
    },
  });
  const apiUrl = await app.listen(0);
  const admin = await startAdminConsole(
    {
      ctx: app.ctx,
      metrics,
      logs,
      logFile: null,
      publicUrl: () => apiUrl,
      tls: () => ({ mode: "off" }),
      portmap: () => null,
      actions: {
        housekeeping: async () => ({
          trashPurged: 0,
          tombstonesPurged: 0,
          uploadsExpired: 0,
        }),
      },
    },
    { host: "127.0.0.1", port: 0 },
  );
  open.push(app, admin);
  const api = (path: string, init: RequestInit = {}) =>
    fetch(admin.url + path, {
      ...init,
      headers: {
        Authorization: `Bearer ${admin.auth.token()}`,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
    });
  return {
    app,
    admin,
    apiUrl,
    logs,
    api,
    async json<T>(path: string, init?: RequestInit): Promise<T> {
      const res = await api(path, init);
      expect(res.status, `${path}: ${await res.clone().text()}`).toBeLessThan(
        300,
      );
      return (await res.json()) as T;
    },
  };
}

async function login(h: Harness): Promise<string> {
  const res = await fetch(
    `${h.admin.url}/login?token=${h.admin.auth.token()}`,
    { redirect: "manual" },
  );
  expect(res.status).toBe(303);
  expect(res.headers.get("location")).toBe("/");
  return res.headers.get("set-cookie")!.split(";")[0]!;
}

describe("authentication", () => {
  it("refuses the API without a token or session", async () => {
    const h = await harness();
    const res = await fetch(`${h.admin.url}/api/overview`);
    expect(res.status).toBe(401);
    expect(
      (
        await fetch(`${h.admin.url}/api/overview`, {
          headers: { Authorization: "Bearer " + "A".repeat(43) },
        })
      ).status,
    ).toBe(401);
  });

  it("serves a login page, not the app, to a signed-out browser", async () => {
    const h = await harness();
    const res = await fetch(`${h.admin.url}/`, { redirect: "manual" });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/login");
    const page = await fetch(`${h.admin.url}/login`);
    expect(page.status).toBe(200);
    expect(await page.text()).toMatch(/storage-server admin/);
  });

  it("exchanges the token for a session cookie and strips it from the URL", async () => {
    const h = await harness();
    const cookie = await login(h);
    expect(cookie).toMatch(/^storage_admin=/);
    const res = await fetch(`${h.admin.url}/api/overview`, {
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(200);
    const app = await fetch(`${h.admin.url}/`, { headers: { Cookie: cookie } });
    expect(app.status).toBe(200);
    expect(await app.text()).toContain('<script src="/app.js" defer></script>');
  });

  it("accepts the token from the login form", async () => {
    const h = await harness();
    const res = await fetch(`${h.admin.url}/login`, {
      method: "POST",
      redirect: "manual",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `token=${h.admin.auth.token()}`,
    });
    expect(res.status).toBe(303);
    expect(res.headers.get("set-cookie")).toMatch(/HttpOnly; SameSite=Strict/);
  });

  it("rejects a wrong token and rate limits guessing", async () => {
    const h = await harness();
    const wrong = await fetch(`${h.admin.url}/login?token=${"B".repeat(43)}`, {
      redirect: "manual",
    });
    expect(wrong.status).toBe(403);
    let last = 0;
    for (let i = 0; i < 12; i++)
      last = (
        await fetch(`${h.admin.url}/login?token=nope`, { redirect: "manual" })
      ).status;
    expect(last).toBe(429);
  });

  it("logout ends the session", async () => {
    const h = await harness();
    const cookie = await login(h);
    const out = await fetch(`${h.admin.url}/logout`, {
      method: "POST",
      redirect: "manual",
      headers: { Cookie: cookie, "X-Storage-Admin": "1" },
    });
    expect(out.status).toBe(303);
    expect(
      (
        await fetch(`${h.admin.url}/api/overview`, {
          headers: { Cookie: cookie },
        })
      ).status,
    ).toBe(401);
  });
});

describe("browser guards", () => {
  it("rejects a Host header that is a domain name (DNS rebinding)", async () => {
    const h = await harness();
    const { request } = await import("node:http");
    const status = await new Promise<number>((resolve) => {
      const url = new URL(h.admin.url);
      request(
        {
          host: url.hostname,
          port: url.port,
          path: "/api/overview",
          headers: {
            Host: "attacker.example:8081",
            Authorization: `Bearer ${h.admin.auth.token()}`,
          },
        },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        },
      ).end();
    });
    expect(status).toBe(421);
  });

  it("requires the CSRF header for cookie-authenticated writes", async () => {
    const h = await harness();
    const cookie = await login(h);
    const body = JSON.stringify({ name: "mum", role: "member" });
    const headers = { Cookie: cookie, "Content-Type": "application/json" };
    const bare = await fetch(`${h.admin.url}/api/accounts`, {
      method: "POST",
      headers,
      body,
    });
    expect(bare.status).toBe(403);
    const crossSite = await fetch(`${h.admin.url}/api/accounts`, {
      method: "POST",
      headers: {
        ...headers,
        "X-Storage-Admin": "1",
        Origin: "https://evil.example",
      },
      body,
    });
    expect(crossSite.status).toBe(403);
    const ok = await fetch(`${h.admin.url}/api/accounts`, {
      method: "POST",
      headers: { ...headers, "X-Storage-Admin": "1", Origin: h.admin.url },
      body,
    });
    expect(ok.status).toBe(201);
  });

  it("sends strict security headers and serves the UI assets", async () => {
    const h = await harness();
    const res = await fetch(`${h.admin.url}/login`);
    expect(res.headers.get("content-security-policy")).toContain(
      "script-src 'self'",
    );
    expect(res.headers.get("content-security-policy")).toContain(
      "frame-ancestors 'none'",
    );
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    const js = await fetch(`${h.admin.url}/app.js`);
    expect(js.headers.get("content-type")).toMatch(/javascript/);
    expect((await js.text()).length).toBeGreaterThan(1000);
    const css = await fetch(`${h.admin.url}/app.css`);
    expect(css.headers.get("content-type")).toMatch(/text\/css/);
  });
});

describe("API", () => {
  it("overview: server, storage, counts, traffic and health", async () => {
    const h = await harness();
    createAccount(h.app.ctx, { name: "root", role: "admin" });
    for (let i = 0; i < 3; i++) await fetch(`${h.apiUrl}/v1/info`);
    const o = await h.json("/api/overview");
    expect(o.server).toMatchObject({
      name: "home",
      version: expect.any(String),
    });
    expect(o.server.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(o.counts).toMatchObject({ accounts: 1, admins: 1, devices: 0 });
    expect(o.traffic.totals.requests).toBe(3);
    expect(o.traffic.series).toHaveLength(60);
    expect(o.audit.ok).toBe(true);
    expect(["ok", "warn", "fail"]).toContain(o.health.status);
    expect(o.urls.public).toBe(h.apiUrl);
  });

  it("accounts: create, update, pair, delete — and each is audited", async () => {
    const h = await harness();
    createAccount(h.app.ctx, { name: "root", role: "admin" });
    const created = await h.json("/api/accounts", {
      method: "POST",
      body: JSON.stringify({ name: "mum", role: "member", quotaBytes: 1024 }),
    });
    expect(created).toMatchObject({
      name: "mum",
      role: "member",
      quotaBytes: 1024,
    });

    const updated = await h.json(`/api/accounts/${created.id}`, {
      method: "PATCH",
      body: JSON.stringify({ role: "guest", disabled: true, name: "Mum" }),
    });
    expect(updated).toMatchObject({
      name: "Mum",
      role: "guest",
      disabled: true,
    });

    const pairing = await h.json(`/api/accounts/${created.id}/pairing`, {
      method: "POST",
    });
    expect(pairing.payload).toMatch(/^oss-storage:\/\/pair\?v=1/);
    expect(pairing.svg).toMatch(/^<svg/);
    expect(pairing.expiresAt).toBeGreaterThan(Date.now());

    const list = await h.json("/api/accounts");
    expect(list.map((a: { name: string }) => a.name).sort()).toEqual([
      "Mum",
      "root",
    ]);
    expect(list.find((a: { name: string }) => a.name === "Mum")).toMatchObject({
      devices: 0,
      namespaces: 0,
    });

    const refuse = await h.api(`/api/accounts/${created.id}`, {
      method: "DELETE",
      body: JSON.stringify({ confirm: "mum?" }),
    });
    expect(refuse.status).toBe(400);
    await h.json(`/api/accounts/${created.id}`, {
      method: "DELETE",
      body: JSON.stringify({ confirm: "Mum" }),
    });
    expect((await h.json("/api/accounts")).length).toBe(1);

    const audit = await h.json("/api/audit");
    const actions = audit.entries.map((e: { action: string }) => e.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        "account.create",
        "account.update",
        "pairing.create",
        "account.delete",
      ]),
    );
    expect(
      audit.entries.find(
        (e: { action: string }) => e.action === "account.delete",
      ).actor,
    ).toBe("admin-console");
  });

  it("pairing for a new account", async () => {
    const h = await harness();
    const p = await h.json("/api/pairing", {
      method: "POST",
      body: JSON.stringify({ name: "dad", role: "member" }),
    });
    expect(p.payload).toContain("pair?v=1");
    const bad = await h.api("/api/pairing", {
      method: "POST",
      body: JSON.stringify({ name: "", role: "member" }),
    });
    expect(bad.status).toBe(400);
  });

  it("pairs an admin device for an admin account only (SPEC §11.2)", async () => {
    const h = await harness();
    const admin = createAccount(h.app.ctx, { name: "me", role: "admin" });
    const kid = createAccount(h.app.ctx, { name: "kid", role: "member" });
    const p = await h.json(`/api/accounts/${admin.id}/pairing`, {
      method: "POST",
      body: JSON.stringify({ console: true }),
    });
    expect(p.payload).toContain("pair?v=1");
    const row = h.app.ctx.db.get<{ console: number }>(
      "SELECT console FROM pairings ORDER BY created_at DESC LIMIT 1",
    );
    expect(row?.console).toBe(1);
    const refused = await h.api(`/api/accounts/${kid.id}/pairing`, {
      method: "POST",
      body: JSON.stringify({ console: true }),
    });
    expect(refused.status).toBe(400);
  });

  it("devices: list across accounts and revoke", async () => {
    const h = await harness();
    const acc = createAccount(h.app.ctx, { name: "mum", role: "member" });
    const keys = await deviceKeys();
    const devId = insertDevice(
      h.app.ctx,
      acc.id,
      {
        name: "Mum's phone",
        platform: "ios",
        dskPublic: keys.dskPublic,
        dekPublic: keys.dekPublic,
      },
      "https://meds.example",
    );
    const list = await h.json("/api/devices");
    expect(list).toEqual([
      expect.objectContaining({
        id: devId,
        name: "Mum's phone",
        account: "mum",
        origin: "https://meds.example",
        state: "pending",
      }),
    ]);
    await h.json(`/api/devices/${devId}`, { method: "DELETE" });
    expect((await h.json("/api/devices"))[0].state).toBe("revoked");
    expect(
      (await h.api("/api/devices/dev_nope", { method: "DELETE" })).status,
    ).toBe(404);
  });

  it("namespaces: metadata only", async () => {
    const h = await harness();
    const list = await h.json("/api/namespaces");
    expect(list).toEqual([]);
  });

  it("logs: query, filter and live stream", async () => {
    const h = await harness();
    h.app.ctx.log.info("hello from the server");
    h.app.ctx.log.error("disk trouble");
    const all = await h.json("/api/logs");
    expect(all.entries.map((e: { message: string }) => e.message)).toEqual(
      expect.arrayContaining(["hello from the server", "disk trouble"]),
    );
    const errors = await h.json("/api/logs?level=error");
    expect(errors.entries.map((e: { level: string }) => e.level)).toEqual([
      "error",
    ]);
    const after = all.entries.at(-1).seq;

    const res = await h.api("/api/logs/stream");
    expect(res.headers.get("content-type")).toMatch(/text\/event-stream/);
    const reader = res.body!.getReader();
    h.app.ctx.log.warn("live line");
    let text = "";
    while (!text.includes("live line")) {
      const { value } = await reader.read();
      text += new TextDecoder().decode(value);
    }
    await reader.cancel();
    expect(text).toMatch(/event: log\ndata: \{"seq":\d+,/);
    expect(
      (await h.json(`/api/logs?after=${after}`)).entries.map(
        (e: { message: string }) => e.message,
      ),
    ).toEqual(["live line"]);
  });

  it("audit: newest first, filter, and verify", async () => {
    const h = await harness();
    createAccount(h.app.ctx, { name: "a", role: "admin" }, "cli");
    createAccount(h.app.ctx, { name: "b", role: "member" }, "cli");
    const page = await h.json("/api/audit?limit=1");
    expect(page.entries).toHaveLength(1);
    expect(page.entries[0].id).toBe(2);
    const older = await h.json(`/api/audit?before=2`);
    expect(older.entries.map((e: { id: number }) => e.id)).toEqual([1]);
    const filtered = await h.json("/api/audit?action=account.create");
    expect(filtered.entries).toHaveLength(2);
    const v = await h.json("/api/audit/verify", { method: "POST" });
    expect(v).toMatchObject({ ok: true, count: 2 });
  });

  it("checks, config (redacted) and actions", async () => {
    const h = await harness();
    const checks = await h.json("/api/checks");
    expect(checks.results.map((r: { id: string }) => r.id)).toContain(
      "database",
    );
    const config = await h.json("/api/config");
    expect(config.name).toBe("home");
    expect(JSON.stringify(config)).not.toMatch(/testSecret":"[^n]/);
    const hk = await h.json("/api/actions/housekeeping", { method: "POST" });
    expect(hk).toMatchObject({ trashPurged: 0 });
    const renew = await h.api("/api/actions/renew-certificate", {
      method: "POST",
    });
    expect(renew.status).toBe(409); // not in acme mode
  });

  it("backup writes a consistent copy under the data directory", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "storage-console-"));
    dirs.push(dataDir);
    const h = await harness({ dataDir });
    createAccount(h.app.ctx, { name: "root", role: "admin" });
    const r = await h.json("/api/actions/backup", { method: "POST" });
    expect(r.path).toContain(join(dataDir, "backups"));
    const { existsSync } = await import("node:fs");
    expect(existsSync(join(r.path, "storage.db"))).toBe(true);
    expect(existsSync(join(r.path, "admin.token"))).toBe(false);
  });

  it("diagnostics bundle holds no token", async () => {
    const h = await harness();
    const res = await h.api("/api/diagnostics");
    expect(res.headers.get("content-disposition")).toMatch(
      /attachment; filename="storage-diagnostics-.*\.json"/,
    );
    const text = await res.text();
    const d = JSON.parse(text);
    expect(Object.keys(d)).toEqual(
      expect.arrayContaining([
        "overview",
        "checks",
        "config",
        "metrics",
        "logs",
      ]),
    );
    expect(text).not.toContain(h.admin.auth.token());
  });

  it("metrics: JSON and Prometheus", async () => {
    const h = await harness();
    await fetch(`${h.apiUrl}/v1/info`);
    const m = await h.json("/api/metrics");
    expect(m.routes[0]).toMatchObject({ route: "/v1/info", count: 1 });
    const prom = await h.api("/metrics");
    expect(prom.headers.get("content-type")).toMatch(
      /text\/plain; version=0.0.4/,
    );
    const text = await prom.text();
    expect(text).toContain(
      'storage_http_requests_total{method="GET",route="/v1/info",status="200"} 1',
    );
    expect(text).toContain("storage_accounts 0");
    expect(text).toContain("storage_audit_chain_ok 1");
  });

  it("validates input and answers unknown endpoints with 404", async () => {
    const h = await harness();
    expect(
      (
        await h.api("/api/accounts", {
          method: "POST",
          body: JSON.stringify({ name: "x", role: "superuser" }),
        })
      ).status,
    ).toBe(400);
    expect((await h.api("/api/nope")).status).toBe(404);
    expect((await h.api("/api/accounts", { method: "PUT" })).status).toBe(405);
  });
});
