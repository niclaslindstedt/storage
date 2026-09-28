// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// `serve`, `test-server`, `backup`, `cert`, `upnp` and `doctor`.

import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { createServer as createHttp, request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { resolve } from "node:path";

import { runChecks } from "../../admin/checks.ts";
import { createStorageServer } from "../../app.ts";
import { writeBackup } from "../../backup.ts";
import type { ServerConfig } from "../../config.ts";
import { PortMapper } from "../../net/portmap.ts";
import { unreachableReason } from "../../net/netinfo.ts";
import { discoverGateway, UpnpClient } from "../../net/upnp.ts";
import { startServer } from "../../serve.ts";
import { listAccounts } from "../../services/accounts.ts";
import { createPairing } from "../../services/pairing.ts";
import {
  describeCertificate,
  readCertificatePem,
} from "../../tls/cert-info.ts";
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
  const running = await startServer(config, {
    log: io.log,
    logFile: io.logFile,
  });
  // Through the server's logger, so the console's Logs page shows them too.
  const { log } = running;
  log.header(`storage-server — ${config.name}`);
  log.status(`listening on ${running.url} (tls: ${config.tls.mode})`);
  const signIn = running.adminLoginUrl();
  if (signIn) {
    // The sign-in link carries the admin token. Show it only on an interactive
    // terminal: never in the log file, nor in a journal or container log that
    // people who cannot read the data directory may be able to read.
    if (io.tty) io.err(`admin console: ${signIn}`);
    else
      log.info(
        `admin console on ${running.adminUrl} — run \`storage-server admin\` for the sign-in link`,
      );
  }
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
    console: {},
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
  const ctx = openContext(config, io.log);
  try {
    writeBackup(ctx, dir);
    io.log.status(
      `backup written to ${dir} (audit head ${ctx.audit.head().slice(0, 16)}…)`,
    );
    return EXIT.ok;
  } finally {
    ctx.db.close();
  }
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
    const pem = readCertificatePem(config);
    if (!pem) {
      io.out(
        "no certificate yet (one is obtained or generated when the server starts)",
      );
      return EXIT.ok;
    }
    const d = describeCertificate(pem);
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
  try {
    mkdirSync(config.dataDir!, { recursive: true, mode: 0o700 });
  } catch (err) {
    io.log.error(`cannot create ${config.dataDir}`, err);
    return EXIT.failure;
  }
  const ctx = openContext(config, io.log);
  let results;
  try {
    results = await runChecks({ ctx });
  } finally {
    ctx.db.close();
  }
  for (const r of results) {
    const line = `${r.label} — ${r.detail}`;
    if (r.status === "ok") io.log.status(line);
    else if (r.status === "skip")
      io.log.info(`- ${r.label}: skipped (${r.detail})`);
    else if (r.status === "warn") io.log.warn(line);
    else io.log.error(line);
    if (r.hint && r.status !== "ok") io.log.info(`  → ${r.hint}`);
  }
  return results.some((r) => r.status === "fail") ? EXIT.failure : EXIT.ok;
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
