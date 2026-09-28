// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Assemble a storage server: context + routes + request handler. This is the
// embeddable core — `serve.ts` adds TLS, ACME, UPnP and background jobs on
// top, and the testkit runs it in-process in test mode.

import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";

import { type ConsoleApi, createConsoleApi } from "./admin/api.ts";
import type { ConsoleDeps } from "./admin/deps.ts";
import { LogBuffer, teeLogger } from "./admin/log-buffer.ts";
import { Metrics } from "./admin/metrics.ts";
import { remoteConsoleRoutes } from "./admin/remote.ts";
import { runRetention } from "./services/retention.ts";
import { adminRoutes } from "./api/admin.ts";
import { fileRoutes } from "./api/files.ts";
import { identityRoutes } from "./api/identity.ts";
import { namespaceRoutes } from "./api/namespaces.ts";
import { recordRoutes } from "./api/records.ts";
import { type TestControls, testRoutes } from "./api/testing.ts";
import type { BlobStore } from "./blobs.ts";
import { type ConfigOverrides, resolveConfig } from "./config.ts";
import { type Ctx, createContext } from "./context.ts";
import type { Db } from "./db/database.ts";
import { createHandler, type FaultRule } from "./http/handler.ts";
import { Router } from "./http/router.ts";
import { createMemoryLogger, type Logger } from "./log.ts";
import { type Clock, OffsetClock } from "./util/clock.ts";
import { newSecret } from "./util/random.ts";
import { VERSION } from "./version.ts";

export type StorageServerOptions = {
  config?: ConfigOverrides;
  clock?: Clock;
  log?: Logger;
  db?: Db;
  blobStore?: BlobStore;
  /** Reports the TLS mode / certificate fingerprint for `/v1/info`. */
  tlsInfo?: () => { mode: string; fp?: string };
  /** Whether TLS terminates in this process (enables HSTS). */
  secure?: boolean;
  /** Collect request metrics (the admin console reads them). */
  metrics?: Metrics;
  /**
   * Build the admin console's API and mount the remote console on it
   * (`/v1/console/*`, SPEC §11.2). `serve` passes its log buffer, TLS and
   * port-mapping hooks; test servers pass `{}` and get working defaults.
   */
  console?: ConsoleOptions;
};

export type ConsoleOptions = Partial<
  Omit<ConsoleDeps, "ctx" | "metrics" | "actions">
> & { actions?: Partial<ConsoleDeps["actions"]> };

export type StorageServer = {
  readonly ctx: Ctx;
  readonly router: Router;
  readonly handle: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
  /** Test mode only: the secret `/__test/*` calls must carry. */
  readonly testSecret: string | null;
  readonly faults: FaultRule[];
  /** The admin console's API when `console` was given (shared with `serve`'s listener). */
  readonly console: ConsoleApi | null;
  /** The base URL once listening (or the configured public URL). */
  url(): string;
  /** Listen on plain HTTP (tests, or behind a TLS-terminating proxy). */
  listen(port?: number, host?: string): Promise<string>;
  /** Adopt an externally created server (HTTPS) for `close()` bookkeeping. */
  attach(server: Server, url: string): void;
  close(): Promise<void>;
};

export function createStorageServer(
  options: StorageServerOptions = {},
): StorageServer {
  const config = resolveConfig(options.config);
  const offsetClock =
    config.testMode && !options.clock ? new OffsetClock() : null;
  // A console without its own log buffer gets one fed by this server's
  // logger, so its Logs page (and the remote one) shows what it logs.
  const consoleLogs = options.console
    ? (options.console.logs ?? new LogBuffer({ clock: options.clock }))
    : null;
  const ctx = createContext(config, {
    clock: options.clock ?? offsetClock ?? undefined,
    log:
      consoleLogs && !options.console!.logs
        ? teeLogger(options.log ?? createMemoryLogger(), consoleLogs)
        : options.log,
    db: options.db,
    blobStore: options.blobStore,
  });
  const router = new Router();
  const faults: FaultRule[] = [];
  let baseUrl = config.publicUrl ?? "";
  const servers: Server[] = [];

  identityRoutes(router, ctx, () => ({
    version: VERSION,
    tls: options.tlsInfo?.() ?? { mode: config.tls.mode },
  }));
  namespaceRoutes(router, ctx);
  fileRoutes(router, ctx);
  recordRoutes(router, ctx);
  adminRoutes(router, ctx);

  let testSecret: string | null = null;
  if (config.testMode) {
    testSecret = config.testSecret ?? newSecret();
    const controls: TestControls = {
      secret: testSecret,
      faults,
      clock: offsetClock,
      baseUrl: () => baseUrl,
    };
    testRoutes(router, ctx, controls);
    ctx.log.warn(
      "TEST MODE: /__test/* is enabled — never use this server for real data",
    );
  }

  const metrics =
    options.metrics ?? (options.console ? new Metrics(ctx.clock) : undefined);
  let consoleApi: ConsoleApi | null = null;
  if (options.console) {
    const c = options.console;
    consoleApi = createConsoleApi({
      ctx,
      metrics: metrics!,
      logs: consoleLogs!,
      logFile: c.logFile ?? null,
      publicUrl: c.publicUrl ?? (() => baseUrl),
      tls: c.tls ?? (() => options.tlsInfo?.() ?? { mode: config.tls.mode }),
      portmap: c.portmap ?? (() => null),
      actions: {
        housekeeping: () => runRetention(ctx),
        ...c.actions,
      },
    });
    remoteConsoleRoutes(router, consoleApi);
  }

  const handle = createHandler(ctx, router, {
    secure: options.secure ?? false,
    faults: config.testMode ? faults : undefined,
    metrics,
  });

  return {
    ctx,
    router,
    handle,
    testSecret,
    faults,
    console: consoleApi,
    url: () => baseUrl,
    async listen(port = 0, host = "127.0.0.1") {
      const server = createServer(
        { requestTimeout: 120_000, headersTimeout: 30_000 },
        (req, res) => {
          void handle(req, res);
        },
      );
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, () => resolve());
      });
      const addr = server.address() as AddressInfo;
      const h = host.includes(":") ? `[${host}]` : host;
      const url = `http://${h === "0.0.0.0" ? "127.0.0.1" : h}:${addr.port}`;
      servers.push(server);
      if (!config.publicUrl) baseUrl = url;
      return url;
    },
    attach(server, url) {
      servers.push(server);
      if (!config.publicUrl) baseUrl = url;
    },
    async close() {
      ctx.events.closeAll();
      await Promise.all(
        servers.splice(0).map(
          (s) =>
            new Promise<void>((resolve) => {
              s.close(() => resolve());
              s.closeAllConnections?.();
            }),
        ),
      );
      ctx.db.close();
    },
  };
}
