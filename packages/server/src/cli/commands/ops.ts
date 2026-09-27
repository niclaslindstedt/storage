// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// `serve`, `test-server`, `backup`, `cert`, `upnp` and `doctor`.

import { X509Certificate, createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  accessSync,
  constants,
} from "node:fs";
import { createServer as createHttp, request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { join, resolve } from "node:path";

import { createStorageServer } from "../../app.ts";
import type { ServerConfig } from "../../config.ts";
import { PortMapper } from "../../net/portmap.ts";
import { unreachableReason } from "../../net/netinfo.ts";
import { discoverGateway, UpnpClient } from "../../net/upnp.ts";
import { startServer } from "../../serve.ts";
import { listAccounts } from "../../services/accounts.ts";
import { createPairing } from "../../services/pairing.ts";
import { TlsManager } from "../../tls/manager.ts";
import { UsageError, type ParsedArgs } from "../args.ts";
import { type CliIo, openContext } from "../io.ts";
import { EXIT } from "../spec.ts";
import { printPairing } from "./pairing.ts";

const until = (signal: AbortSignal) =>
  new Promise<void>((r) =>
    signal.aborted
      ? r()
      : signal.addEventListener("abort", () => r(), { once: true }),
  );

export async function runServe(
  io: CliIo,
  config: ServerConfig,
): Promise<number> {
  const running = await startServer(config, { log: io.log });
  const { log } = io;
  log.header(`storage-server — ${config.name}`);
  log.status(`listening on ${running.url} (tls: ${config.tls.mode})`);
  if (running.adminUrl)
    log.info(`admin page (this machine only): ${running.adminUrl}`);
  const pm = running.portmap();
  if (pm?.error) log.warn(`port mapping: ${pm.error}`);
  log.info(`data: ${config.dataDir}`);
  if (listAccounts(running.app.ctx).length === 0) {
    const created = createPairing(
      running.app.ctx,
      { newAccount: { name: "admin", role: "admin" } },
      "first-run",
    );
    printPairing(
      io,
      { ...config, publicUrl: config.publicUrl ?? running.url },
      { code: created.code!, expiresAt: created.expiresAt },
      {
        qr: true,
        json: false,
        heading:
          "\nFirst run: scan this with your first device to create the admin account.",
      },
    );
  }
  await until(io.signal);
  log.info("shutting down");
  await running.close();
  return EXIT.ok;
}

export async function runTestServer(
  io: CliIo,
  args: ParsedArgs,
): Promise<number> {
  const server = createStorageServer({
    log: io.log,
    config: {
      name: "test",
      testMode: true,
      testSecret: (args.flags.secret as string | undefined) ?? null,
      cors: {
        mode: ((args.flags.cors as string | undefined) ?? "any") as
          "any" | "paired",
      },
      rateLimit: { publicPerMinute: 100_000, devicePerMinute: 1_000_000 },
    },
  });
  const url = await server.listen(
    (args.flags.port as number | undefined) ?? 0,
    (args.flags.host as string | undefined) ?? "127.0.0.1",
  );
  io.out(JSON.stringify({ url, secret: server.testSecret }));
  await until(io.signal);
  await server.close();
  return EXIT.ok;
}

export async function runBackup(
  io: CliIo,
  config: ServerConfig,
  args: ParsedArgs,
): Promise<number> {
  const out = args.flags.out as string | undefined;
  if (!out) throw new UsageError("--out <dir> is required");
  const dir = resolve(out);
  if (existsSync(dir) && readdirSync(dir).length > 0) {
    io.err(`${dir} is not empty`);
    return EXIT.failure;
  }
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const ctx = openContext(config, io.log);
  try {
    const target = join(dir, "storage.db").replaceAll("'", "''");
    ctx.db.exec(`VACUUM INTO '${target}'`);
    for (const sub of ["blobs", "tls"]) {
      const src = join(config.dataDir!, sub);
      if (existsSync(src))
        cpSync(src, join(dir, sub), {
          recursive: true,
          filter: (p) => !p.includes(`${join("blobs", "tmp")}`),
        });
    }
    const cfg = join(config.dataDir!, "config.json");
    if (existsSync(cfg)) cpSync(cfg, join(dir, "config.json"));
    io.log.status(
      `backup written to ${dir} (audit head ${ctx.audit.head().slice(0, 16)}…)`,
    );
    return EXIT.ok;
  } finally {
    ctx.db.close();
  }
}

function describeCert(pem: string): {
  names: string;
  notAfter: string;
  fp: string;
  days: number;
} {
  const cert = new X509Certificate(pem);
  const fp = createHash("sha256")
    .update(cert.publicKey.export({ type: "spki", format: "der" }))
    .digest("base64url");
  const notAfter = Date.parse(cert.validTo);
  return {
    names: cert.subjectAltName ?? cert.subject,
    notAfter: new Date(notAfter).toISOString(),
    fp,
    days: Math.floor((notAfter - Date.now()) / 86400_000),
  };
}

function certPem(config: ServerConfig): string | null {
  const tlsDir = join(config.dataDir!, "tls");
  const file =
    config.tls.mode === "files"
      ? config.tls.certFile
      : config.tls.mode === "acme"
        ? join(tlsDir, "cert.pem")
        : config.tls.mode === "self-signed"
          ? join(tlsDir, "self-signed.crt")
          : null;
  return file && existsSync(file) ? readFileSync(file, "utf8") : null;
}

export async function runCert(
  io: CliIo,
  config: ServerConfig,
  args: ParsedArgs,
): Promise<number> {
  const [sub] = args.positionals;
  if ((sub ?? "status") === "status") {
    io.out(`mode: ${config.tls.mode}`);
    if (config.tls.mode === "off") {
      io.out("TLS is terminated by a reverse proxy or tunnel.");
      return EXIT.ok;
    }
    const pem = certPem(config);
    if (!pem) {
      io.out(
        "no certificate yet (one is obtained or generated when the server starts)",
      );
      return EXIT.ok;
    }
    const d = describeCert(pem);
    io.out(
      `names: ${d.names}\nexpires: ${d.notAfter} (${d.days} days)\nkey fingerprint (sha256 spki): ${d.fp}`,
    );
    return d.days < 0 ? EXIT.failure : EXIT.ok;
  }
  if (sub === "renew") {
    if (config.tls.mode !== "acme")
      throw new UsageError("renew needs --tls acme");
    const tls = new TlsManager({
      config,
      log: io.log,
      clock: { now: () => Date.now() },
    });
    // Answer http-01 on the HTTP port while renewing (stop the server first).
    const http = createHttp((req, res) => {
      if (!tls.handleHttp01(req, res)) res.writeHead(404).end();
    });
    if (config.listen.httpPort !== null)
      await new Promise<void>((r) =>
        http.listen(config.listen.httpPort!, config.listen.host, r),
      );
    try {
      await tls.renew();
      return EXIT.ok;
    } finally {
      http.close();
    }
  }
  throw new UsageError(`unknown subcommand cert ${sub}`);
}

export async function runUpnp(
  io: CliIo,
  config: ServerConfig,
  args: ParsedArgs,
): Promise<number> {
  const [sub] = args.positionals;
  const port = (args.flags.port as number | undefined) ?? config.listen.port;
  const external = (args.flags.external as number | undefined) ?? 443;
  if ((sub ?? "status") === "status") {
    const gw = await discoverGateway();
    if (!gw) {
      io.out(
        "no UPnP gateway answered (UPnP may be disabled on the router; NAT-PMP is tried by `serve --upnp`)",
      );
      return EXIT.failure;
    }
    const ip = await new UpnpClient(gw).externalIp();
    io.out(
      `gateway: ${gw.location}\nservice: ${gw.serviceType}\nexternal address: ${ip ?? "unknown"}`,
    );
    const why = ip ? unreachableReason(ip) : null;
    if (why) io.out(`warning: ${why}`);
    return EXIT.ok;
  }
  const pm = new PortMapper({
    log: io.log,
    leaseSeconds: config.upnp.leaseSeconds,
  });
  if (sub === "map") {
    const st = await pm.start([{ internal: port, external }]);
    return st.method ? EXIT.ok : EXIT.failure;
  }
  if (sub === "unmap") {
    const gw = await discoverGateway();
    if (!gw) return EXIT.failure;
    await new UpnpClient(gw).deletePortMapping(external);
    io.log.status(`removed mapping for external port ${external}`);
    return EXIT.ok;
  }
  throw new UsageError(`unknown subcommand upnp ${sub}`);
}

export async function runDoctor(
  io: CliIo,
  config: ServerConfig,
): Promise<number> {
  let failed = 0;
  const check = (ok: boolean, label: string, detail = "") => {
    if (ok) io.log.status(`${label}${detail ? ` — ${detail}` : ""}`);
    else {
      failed++;
      io.log.error(`${label}${detail ? ` — ${detail}` : ""}`);
    }
  };
  try {
    mkdirSync(config.dataDir!, { recursive: true, mode: 0o700 });
    accessSync(config.dataDir!, constants.W_OK);
    check(true, "data directory writable", config.dataDir!);
  } catch (err) {
    check(false, "data directory writable", (err as Error).message);
    return EXIT.failure;
  }
  const ctx = openContext(config, io.log);
  try {
    const integrity = ctx.db.get<{ integrity_check: string }>(
      "PRAGMA integrity_check",
    )?.integrity_check;
    check(integrity === "ok", "database integrity", integrity ?? "unknown");
    const audit = ctx.audit.verify();
    check(
      audit.ok,
      "audit chain",
      audit.ok ? `${audit.count} entries` : `broken at ${audit.brokenAt}`,
    );
    check(
      listAccounts(ctx).some((a) => a.role === "admin"),
      "an admin account exists",
      "run `storage-server setup` if not",
    );
  } finally {
    ctx.db.close();
  }
  if (config.tls.mode !== "off") {
    const pem = certPem(config);
    if (pem) {
      const d = describeCert(pem);
      check(d.days > 3, "certificate valid", `${d.names}, ${d.days} days left`);
    } else
      check(config.tls.mode !== "files", "certificate present", "none yet");
  }
  if (config.upnp.enabled) {
    const gw = await discoverGateway({ timeoutMs: 2000 });
    const ip = gw
      ? await new UpnpClient(gw).externalIp().catch(() => null)
      : null;
    check(Boolean(gw), "UPnP gateway", gw ? `${ip ?? "?"}` : "none answered");
    const why = ip ? unreachableReason(ip) : null;
    if (why) check(false, "reachable from the internet", why);
  }
  if (config.publicUrl) {
    try {
      const res = await fetch(new URL("/v1/info", config.publicUrl), {
        signal: AbortSignal.timeout(8000),
      });
      check(
        res.ok,
        "public URL answers",
        `${config.publicUrl} → HTTP ${res.status}`,
      );
    } catch (err) {
      check(
        false,
        "public URL answers",
        `${config.publicUrl}: ${(err as Error).message}`,
      );
    }
  }
  return failed === 0 ? EXIT.ok : EXIT.failure;
}

export function runHealth(config: ServerConfig): Promise<number> {
  const secure = config.tls.mode !== "off";
  const req = secure ? httpsRequest : httpRequest;
  return new Promise((resolve) => {
    const r = req(
      {
        host: "127.0.0.1",
        port: config.listen.port,
        path: "/v1/info",
        method: "GET",
        timeout: 3000,
        rejectUnauthorized: false,
      },
      (res) => {
        res.resume();
        resolve(res.statusCode === 200 ? EXIT.ok : EXIT.failure);
      },
    );
    r.on("timeout", () => r.destroy());
    r.on("error", () => resolve(EXIT.failure));
    r.end();
  });
}
