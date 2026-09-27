import { X509Certificate } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer as createHttp } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer as createTls } from "node:tls";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import { resolveConfig } from "../src/config.ts";
import { createMemoryLogger } from "../src/log.ts";
import { TlsManager } from "../src/tls/manager.ts";
import { generateP256, selfSigned } from "../src/tls/x509.ts";
import { ManualClock } from "../src/util/clock.ts";
import { startFakeAcme } from "./fake-acme.ts";

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "tls-"));
  cleanups.push(() => rmSync(d, { recursive: true, force: true }));
  return d;
}

describe("TlsManager", () => {
  it("self-signed: generates once and reuses from the data dir", async () => {
    const dataDir = tmp();
    const config = resolveConfig({
      dataDir,
      tls: { mode: "self-signed", domains: ["home.example"] },
    });
    const a = new TlsManager({
      config,
      log: createMemoryLogger(),
      clock: new ManualClock(Date.now()),
    });
    await a.start();
    const fp = a.info().fp;
    expect(fp).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(new X509Certificate(a.credentials()!.cert).subjectAltName).toContain(
      "DNS:home.example",
    );
    const b = new TlsManager({
      config,
      log: createMemoryLogger(),
      clock: new ManualClock(Date.now()),
    });
    await b.start();
    expect(b.info().fp).toBe(fp);
  });

  it("files: loads PEM files", async () => {
    const dir = tmp();
    const key = generateP256();
    writeFileSync(join(dir, "k.pem"), key.keyPem);
    writeFileSync(
      join(dir, "c.pem"),
      selfSigned(["files.example"], key, new Date()),
    );
    const config = resolveConfig({
      tls: {
        mode: "files",
        certFile: join(dir, "c.pem"),
        keyFile: join(dir, "k.pem"),
      },
    });
    const m = new TlsManager({
      config,
      log: createMemoryLogger(),
      clock: new ManualClock(Date.now()),
    });
    await m.start();
    cleanups.push(() => m.stop());
    expect(m.info().mode).toBe("files");
    expect(new X509Certificate(m.credentials()!.cert).subjectAltName).toContain(
      "files.example",
    );
  });

  it("acme: obtains via http-01 through its own challenge handler, then renews when due", async () => {
    const dataDir = tmp();
    let httpPort = 0;
    let tlsPort = 0;
    const ca = await startFakeAcme({
      httpPort: () => httpPort,
      tlsPort: () => tlsPort,
      lifetimeDays: 6,
    });
    cleanups.push(() => ca.close());
    const clock = new ManualClock(Date.now());
    const config = resolveConfig({
      dataDir,
      listen: { httpPort: 1 },
      tls: { mode: "acme", domains: ["127.0.0.1"], acmeDirectory: ca.url },
    });
    const m = new TlsManager({ config, log: createMemoryLogger(), clock });
    const http = createHttp((req, res) => {
      if (!m.handleHttp01(req, res)) res.writeHead(404).end();
    });
    await new Promise<void>((r) => http.listen(0, "127.0.0.1", r));
    httpPort = (http.address() as AddressInfo).port;
    cleanups.push(() => new Promise((r) => http.close(() => r())));
    const tls = createTls(
      { SNICallback: m.sniCallback, ALPNProtocols: ["acme-tls/1"] },
      (s) => s.end(),
    );
    await new Promise<void>((r) => tls.listen(0, "127.0.0.1", r));
    tlsPort = (tls.address() as AddressInfo).port;
    cleanups.push(() => new Promise((r) => tls.close(() => r())));

    let updates = 0;
    m.onUpdate(() => updates++);
    await m.start();
    cleanups.push(() => m.stop());
    expect(updates).toBe(1);
    expect(ca.orders[0]!.profile).toBe("shortlived");
    expect(m.needsRenewal()).toBe(false);
    clock.advance(5 * 86400_000); // past two thirds of a 6-day lifetime
    expect(m.needsRenewal()).toBe(true);
    await m.renew();
    expect(updates).toBe(2);
    expect(ca.requests.filter((r) => r === "POST /acct")).toHaveLength(1);
  });

  it("acme: needs identifiers", async () => {
    const config = resolveConfig({ tls: { mode: "acme", domains: [] } });
    const m = new TlsManager({
      config,
      log: createMemoryLogger(),
      clock: new ManualClock(Date.now()),
    });
    await expect(m.start()).rejects.toThrow(/domains/);
  });
});
