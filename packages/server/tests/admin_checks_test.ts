import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { type CheckResult, runChecks } from "../src/admin/checks.ts";
import { LogBuffer } from "../src/admin/log-buffer.ts";
import type { ConfigOverrides } from "../src/config.ts";
import { createAccount } from "../src/services/accounts.ts";
import { generateP256, selfSigned } from "../src/tls/x509.ts";
import { testContext } from "./helpers.ts";

const dirs: string[] = [];
const servers: Server[] = [];
afterEach(async () => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  await Promise.all(
    servers.splice(0).map((s) => new Promise((r) => s.close(r))),
  );
});

function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), "storage-checks-"));
  chmodSync(d, 0o700);
  dirs.push(d);
  return d;
}

const byId = (results: CheckResult[]) =>
  Object.fromEntries(results.map((r) => [r.id, r]));

async function check(overrides: ConfigOverrides = {}, extra = {}) {
  const ctx = testContext({ tls: { mode: "off" }, ...overrides });
  return { ctx, results: byId(await runChecks({ ctx, ...extra })) };
}

describe("runChecks", () => {
  it("reports every check with a stable id, status and label", async () => {
    const { results } = await check();
    expect(Object.keys(results)).toEqual([
      "data-dir",
      "database",
      "audit-chain",
      "admin-account",
      "disk-space",
      "certificate",
      "port-mapping",
      "public-url",
      "exposure",
      "recent-errors",
    ]);
    for (const r of Object.values(results)) {
      expect(["ok", "warn", "fail", "skip"]).toContain(r.status);
      expect(r.label).toBeTruthy();
    }
  });

  it("an in-memory server skips the filesystem checks; database and audit pass", async () => {
    const { results } = await check();
    expect(results["data-dir"]!.status).toBe("skip");
    expect(results["disk-space"]!.status).toBe("skip");
    expect(results.database!.status).toBe("ok");
    expect(results["audit-chain"]!.status).toBe("ok");
  });

  it("fails without an admin account and says how to fix it", async () => {
    const { ctx, results } = await check();
    expect(results["admin-account"]).toMatchObject({ status: "fail" });
    expect(results["admin-account"]!.hint).toMatch(/storage-server setup/);
    createAccount(ctx, { name: "root", role: "admin" });
    expect(byId(await runChecks({ ctx }))["admin-account"]!.status).toBe("ok");
  });

  it("detects a tampered audit chain", async () => {
    const { ctx } = await check();
    createAccount(ctx, { name: "root", role: "admin" });
    ctx.db.run("UPDATE audit SET action = 'forged' WHERE id = 1");
    const r = byId(await runChecks({ ctx }))["audit-chain"]!;
    expect(r.status).toBe("fail");
    expect(r.detail).toMatch(/entry 1/);
  });

  it("warns when the data directory is readable by other users", async () => {
    const dataDir = tempDir();
    const { ctx, results } = await check({ dataDir });
    expect(results["data-dir"]!.status).toBe("ok");
    expect(results["disk-space"]!.status).toMatch(/ok|warn/);
    chmodSync(dataDir, 0o755);
    const r = byId(await runChecks({ ctx }))["data-dir"]!;
    expect(r.status).toBe("warn");
    expect(r.hint).toMatch(/chmod 700/);
    ctx.db.close();
  });

  it("grades the certificate by days left", async () => {
    const dataDir = tempDir();
    mkdirSync(join(dataDir, "tls"), { recursive: true });
    const key = generateP256();
    const now = new Date(1_800_000_000_000);
    const write = (days: number) =>
      writeFileSync(
        join(dataDir, "tls", "self-signed.crt"),
        selfSigned(
          ["localhost"],
          key,
          new Date(now.getTime() - 86400_000),
          days,
        ),
      );
    const ctx = testContext({ dataDir, tls: { mode: "self-signed" } });
    const cert = async () => byId(await runChecks({ ctx }))["certificate"]!;

    expect((await cert()).status).toBe("fail"); // none yet
    write(90);
    expect(await cert()).toMatchObject({ status: "ok" });
    write(4);
    expect(await cert()).toMatchObject({ status: "warn" });
    write(0.5);
    ctx.clock.advance(2 * 86400_000);
    expect(await cert()).toMatchObject({ status: "fail" });
    ctx.db.close();
  });

  it("skips the certificate when TLS is terminated elsewhere", async () => {
    const { results } = await check({ tls: { mode: "off" } });
    expect(results.certificate!.status).toBe("skip");
  });

  it("reads port mapping state from the running mapper", async () => {
    const upnp = { upnp: { enabled: true } };
    const status = (s: object) => ({
      portmap: () => ({
        method: null,
        externalIp: null,
        mapped: [],
        warning: null,
        error: null,
        ...s,
      }),
    });
    expect((await check()).results["port-mapping"]!.status).toBe("skip");
    expect(
      (await check(upnp, status({ error: "no gateway answered" }))).results[
        "port-mapping"
      ],
    ).toMatchObject({ status: "fail", detail: "no gateway answered" });
    expect(
      (
        await check(
          upnp,
          status({
            method: "upnp",
            externalIp: "100.64.1.2",
            warning: "carrier-grade NAT",
            mapped: [{ internal: 8443, external: 443 }],
          }),
        )
      ).results["port-mapping"]!.status,
    ).toBe("warn");
    expect(
      (
        await check(
          upnp,
          status({
            method: "natpmp",
            externalIp: "203.0.113.7",
            mapped: [{ internal: 8443, external: 443 }],
          }),
        )
      ).results["port-mapping"],
    ).toMatchObject({ status: "ok" });
  });

  it("probes the public URL", async () => {
    let status = 200;
    const server = createServer((req, res) => {
      res.writeHead(req.url === "/v1/info" ? status : 404).end("{}");
    });
    servers.push(server);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    expect((await check()).results["public-url"]!.status).toBe("skip");
    expect(
      (await check({ publicUrl: url })).results["public-url"],
    ).toMatchObject({ status: "ok" });
    status = 502;
    expect(
      (await check({ publicUrl: url })).results["public-url"]!.status,
    ).toBe("fail");
    expect(
      (await check({ publicUrl: "http://127.0.0.1:1" })).results["public-url"]!
        .status,
    ).toBe("fail");
  });

  it("warns about plain HTTP exposed beyond loopback", async () => {
    expect(
      (await check({ listen: { host: "0.0.0.0" }, tls: { mode: "off" } }))
        .results.exposure!.status,
    ).toBe("warn");
    expect(
      (
        await check({
          listen: { host: "0.0.0.0" },
          tls: { mode: "off" },
          trustProxy: true,
        })
      ).results.exposure!.status,
    ).toBe("ok");
    expect(
      (await check({ listen: { host: "127.0.0.1" }, tls: { mode: "off" } }))
        .results.exposure!.status,
    ).toBe("ok");
  });

  it("flags errors logged in the last hour", async () => {
    const { ctx } = await check();
    const logs = new LogBuffer({ clock: ctx.clock });
    expect(byId(await runChecks({ ctx, logs }))["recent-errors"]!.status).toBe(
      "ok",
    );
    logs.push("error", "request failed (Error: disk full)");
    const r = byId(await runChecks({ ctx, logs }))["recent-errors"]!;
    expect(r.status).toBe("warn");
    expect(r.detail).toMatch(/disk full/);
    ctx.clock.advance(2 * 3600_000);
    expect(byId(await runChecks({ ctx, logs }))["recent-errors"]!.status).toBe(
      "ok",
    );
  });
});
