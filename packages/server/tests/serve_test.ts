import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request } from "node:https";

import { afterEach, describe, expect, it } from "vitest";

import { resolveConfig } from "../src/config.ts";
import { createMemoryLogger } from "../src/log.ts";
import { startServer, type RunningServer } from "../src/serve.ts";

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

function tmp() {
  const d = mkdtempSync(join(tmpdir(), "serve-"));
  cleanups.push(() => rmSync(d, { recursive: true, force: true }));
  return d;
}

function getJson(
  url: string,
  ca: string,
): Promise<{
  status: number;
  body: unknown;
  headers: Record<string, unknown>;
}> {
  return new Promise((resolve, reject) => {
    const req = request(url, { ca, servername: "localhost" }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () =>
        resolve({
          status: res.statusCode!,
          body: data ? JSON.parse(data) : null,
          headers: res.headers,
        }),
      );
    });
    req.on("error", reject);
    req.end();
  });
}

describe("startServer", () => {
  it("serves HTTPS with a pinned self-signed certificate, redirects HTTP, and runs the admin console", async () => {
    const dataDir = tmp();
    const config = resolveConfig({
      dataDir,
      listen: { host: "127.0.0.1", port: 0, httpPort: 0, adminPort: 0 },
      tls: { mode: "self-signed" },
    });
    const logger = createMemoryLogger();
    const running: RunningServer = await startServer(config, { log: logger });
    cleanups.push(() => running.close());
    const ca = running.tls.credentials()!.cert;
    const port = new URL(running.url).port;
    const info = await getJson(`https://127.0.0.1:${port}/v1/info`, ca);
    expect(info.status).toBe(200);
    expect(
      (info.body as { tls: { mode: string; fp: string } }).tls,
    ).toMatchObject({ mode: "self-signed" });
    expect(info.headers["strict-transport-security"]).toContain("max-age=");

    // The admin console: signed-out browsers go to the login page …
    expect(running.adminUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    const signedOut = await fetch(`${running.adminUrl}/`, {
      redirect: "manual",
    });
    expect(signedOut.headers.get("location")).toBe("/login");
    // … the token lives in the data directory, never in the log …
    const token = readFileSync(join(dataDir, "admin.token"), "utf8").trim();
    expect(running.adminLoginUrl()).toBe(
      `${running.adminUrl}/login?token=${token}`,
    );
    expect(logger.lines.join("\n")).not.toContain(token);
    // … and it unlocks the API, which pairs with the pinned fingerprint.
    const auth = { Authorization: `Bearer ${token}` };
    const paired = await fetch(`${running.adminUrl}/api/pairing`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Root", role: "admin" }),
    });
    const body = (await paired.json()) as { payload: string; svg: string };
    expect(body.svg).toContain("<svg");
    expect(body.payload).toContain("oss-storage://pair?v=1");
    expect(body.payload).toContain("fp=");

    // Requests to the device API show up in the console's metrics and logs.
    const overview = (await (
      await fetch(`${running.adminUrl}/api/overview`, { headers: auth })
    ).json()) as {
      traffic: { totals: { requests: number } };
      tls: { mode: string };
    };
    expect(overview.traffic.totals.requests).toBeGreaterThanOrEqual(1);
    expect(overview.tls.mode).toBe("self-signed");
    const logs = (await (
      await fetch(`${running.adminUrl}/api/logs`, { headers: auth })
    ).json()) as { entries: { message: string }[] };
    expect(logs.entries.length).toBeGreaterThan(0);
  });

  it("plain HTTP mode for reverse proxies", async () => {
    const config = resolveConfig({
      listen: { host: "127.0.0.1", port: 0, httpPort: null, adminPort: null },
      tls: { mode: "off" },
    });
    const running = await startServer(config, { log: createMemoryLogger() });
    cleanups.push(() => running.close());
    const res = await fetch(`${running.url}/v1/info`);
    expect(res.status).toBe(200);
    expect(res.headers.get("strict-transport-security")).toBeNull();
  });
});
