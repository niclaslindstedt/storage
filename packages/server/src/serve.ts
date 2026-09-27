// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Run a production server: HTTPS (or plain HTTP behind a proxy), ACME
// challenges and HTTP→HTTPS redirects on the HTTP port, the admin console
// (SPEC §11.1), router port mapping, and periodic housekeeping.

import { createServer as createHttp, type Server } from "node:http";
import { createServer as createHttps } from "node:https";
import type { AddressInfo } from "node:net";

import { type AdminConsole, startAdminConsole } from "./admin/console.ts";
import { LogBuffer, teeLogger } from "./admin/log-buffer.ts";
import { Metrics } from "./admin/metrics.ts";
import { createStorageServer, type StorageServer } from "./app.ts";
import type { ServerConfig } from "./config.ts";
import type { Logger } from "./log.ts";
import { lanAddresses } from "./net/netinfo.ts";
import { PortMapper, type PortMapStatus } from "./net/portmap.ts";
import { runRetention } from "./services/retention.ts";
import { TlsManager } from "./tls/manager.ts";
import { generateP256, selfSigned } from "./tls/x509.ts";
import type { Clock } from "./util/clock.ts";

export type RunningServer = {
  app: StorageServer;
  url: string;
  /** The admin console's base URL (no token), or null when disabled. */
  adminUrl: string | null;
  /** A sign-in link with the admin token — print it, never log it. */
  adminLoginUrl(): string | null;
  /** The server's logger (also feeds the console's log buffer). */
  log: Logger;
  logs: LogBuffer;
  metrics: Metrics;
  tls: TlsManager;
  portmap: () => PortMapStatus | null;
  close(): Promise<void>;
};

function listen(server: Server, port: number, host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () =>
      resolve((server.address() as AddressInfo).port),
    );
  });
}

export async function startServer(
  config: ServerConfig,
  deps: { log: Logger; clock?: Clock; logFile?: string | null },
): Promise<RunningServer> {
  const clock = deps.clock ?? { now: () => Date.now() };
  // Everything the server logs also lands in the console's log buffer.
  const logs = new LogBuffer({ clock });
  const log = teeLogger(deps.log, logs);
  const metrics = new Metrics(clock);
  const tls = new TlsManager({
    config,
    log,
    clock,
    extraNames: lanAddresses(),
  });
  const secure = config.tls.mode !== "off";
  const app = createStorageServer({
    config,
    log,
    clock: deps.clock,
    secure,
    tlsInfo: () => tls.info(),
    metrics,
  });
  const servers: Server[] = [];
  const timers: ReturnType<typeof setInterval>[] = [];

  // HTTPS listener. In acme mode it starts on a placeholder certificate so
  // tls-alpn-01 validation can reach it before the real one exists.
  let mainPort: number;
  let url: string;
  const host = config.listen.host;
  if (secure) {
    if (config.tls.mode !== "acme") await tls.start();
    const placeholder = generateP256();
    const creds = tls.credentials() ?? {
      key: placeholder.keyPem,
      cert: selfSigned(["localhost"], placeholder, new Date()),
    };
    const https = createHttps(
      {
        ...creds,
        SNICallback: tls.sniCallback,
        ALPNProtocols: ["http/1.1", "acme-tls/1"],
        minVersion: "TLSv1.2",
        requestTimeout: 120_000,
        headersTimeout: 30_000,
      },
      (req, res) => void app.handle(req, res),
    );
    tls.onUpdate(() => {
      const c = tls.credentials();
      if (c) https.setSecureContext(c);
    });
    mainPort = await listen(https, config.listen.port, host);
    servers.push(https);
    url =
      config.publicUrl ??
      `https://${host === "0.0.0.0" ? "localhost" : host}:${mainPort}`;
  } else {
    const http = createHttp(
      { requestTimeout: 120_000, headersTimeout: 30_000 },
      (req, res) => void app.handle(req, res),
    );
    mainPort = await listen(http, config.listen.port, host);
    servers.push(http);
    url =
      config.publicUrl ??
      `http://${host === "0.0.0.0" ? "localhost" : host}:${mainPort}`;
  }
  app.attach(servers[0]!, url);

  // Plain HTTP: ACME http-01 answers, everything else redirects to HTTPS.
  if (secure && config.listen.httpPort !== null) {
    const redirect = createHttp((req, res) => {
      if (tls.handleHttp01(req, res)) return;
      const target = new URL(req.url ?? "/", url);
      res.writeHead(301, { Location: target.toString() }).end();
    });
    await listen(redirect, config.listen.httpPort, host);
    servers.push(redirect);
  }

  let portmapper: PortMapper | null = null;
  if (config.upnp.enabled) {
    portmapper = new PortMapper({
      log,
      leaseSeconds: config.upnp.leaseSeconds,
      description: `storage (${config.name})`,
    });
    const externalMain = config.publicUrl
      ? Number(new URL(config.publicUrl).port || (secure ? 443 : 80))
      : mainPort;
    const ports = [{ internal: mainPort, external: externalMain }];
    if (secure && config.listen.httpPort !== null)
      ports.push({ internal: config.listen.httpPort, external: 80 });
    await portmapper.start(ports);
  }

  if (config.tls.mode === "acme") {
    try {
      await tls.start();
    } catch (err) {
      log.error(
        "could not obtain a certificate yet; serving a temporary self-signed one and retrying",
        err,
      );
      const retry = setInterval(() => {
        tls
          .renew()
          .then(() => clearInterval(retry))
          .catch((e) => log.warn("certificate retry failed", e));
      }, 15 * 60_000);
      retry.unref();
      timers.push(retry);
    }
  }

  const housekeepingNow = () => runRetention(app.ctx);

  let admin: AdminConsole | null = null;
  if (config.listen.adminPort !== null) {
    admin = await startAdminConsole(
      {
        ctx: app.ctx,
        metrics,
        logs,
        logFile: deps.logFile ?? null,
        publicUrl: () => url,
        tls: () => tls.info(),
        portmap: () => portmapper?.current() ?? null,
        actions: {
          housekeeping: housekeepingNow,
          renewCertificate:
            config.tls.mode === "acme" ? () => tls.renew() : undefined,
          refreshPortMapping: portmapper
            ? () => portmapper!.refresh()
            : undefined,
        },
      },
      { host: config.listen.adminHost, port: config.listen.adminPort },
    );
    servers.push(admin.server);
    log.info(`admin console listening on ${admin.url}`);
  }

  // Housekeeping: now, then hourly.
  const housekeeping = async () => {
    try {
      const r = await housekeepingNow();
      log.debug(`retention: ${JSON.stringify(r)}`);
    } catch (err) {
      log.error("retention failed", err);
    }
  };
  void (async () => {
    const orphans = await app.ctx.blobs.sweepOrphans().catch(() => 0);
    if (orphans > 0) log.info(`removed ${orphans} orphaned blob(s)`);
    await housekeeping();
  })();
  const hourly = setInterval(() => void housekeeping(), 3600_000);
  hourly.unref();
  timers.push(hourly);
  log.debug(`audit head ${app.ctx.audit.head()}`);

  return {
    app,
    url,
    adminUrl: admin?.url ?? null,
    adminLoginUrl: () => admin?.loginUrl() ?? null,
    log,
    logs,
    metrics,
    tls,
    portmap: () => portmapper?.current() ?? null,
    async close() {
      for (const t of timers) clearInterval(t);
      tls.stop();
      await portmapper?.stop();
      await Promise.all(
        servers.slice(1).map(
          (s) =>
            new Promise<void>((r) => {
              s.close(() => r());
              s.closeAllConnections?.();
            }),
        ),
      );
      await app.close();
    },
  };
}
