import { mkdtempSync, rmSync } from "node:fs";
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
  it("serves HTTPS with a pinned self-signed certificate, redirects HTTP, and runs the admin page", async () => {
    const dataDir = tmp();
    const config = resolveConfig({
      dataDir,
      listen: { host: "127.0.0.1", port: 0, httpPort: 0, adminPort: 0 },
      tls: { mode: "self-signed" },
    });
    const running: RunningServer = await startServer(config, {
      log: createMemoryLogger(),
    });
    cleanups.push(() => running.close());
    const ca = running.tls.credentials()!.cert;
    const port = new URL(running.url).port;
    const info = await getJson(`https://127.0.0.1:${port}/v1/info`, ca);
    expect(info.status).toBe(200);
    expect(
      (info.body as { tls: { mode: string; fp: string } }).tls,
    ).toMatchObject({ mode: "self-signed" });
    expect(info.headers["strict-transport-security"]).toContain("max-age=");

    const admin = await fetch(running.adminUrl!);
    expect(admin.status).toBe(200);
    expect(await admin.text()).toContain("Pair a device");
    const noToken = await fetch(running.adminUrl!.split("?")[0]!);
    expect(noToken.status).toBe(403);

    const form = new URLSearchParams({
      t: new URL(running.adminUrl!).searchParams.get("t")!,
      name: "Root",
      role: "admin",
    });
    const paired = await fetch(new URL("/pair", running.adminUrl!), {
      method: "POST",
      body: form,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    const html = await paired.text();
    expect(html).toContain("<svg");
    expect(html).toContain("oss-storage://pair?v=1");
    expect(html).toContain("fp=");
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
