// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// What the admin console's API reads from the running server (SPEC §11.1).
// Its own module so the embeddable server (app.ts, which mounts the remote
// console) never imports the console's listener or its bundled UI.

import type { Ctx } from "../context.ts";
import type { PortMapStatus } from "../net/portmap.ts";
import type { RetentionReport } from "../services/retention.ts";
import type { LogBuffer } from "./log-buffer.ts";
import type { Metrics } from "./metrics.ts";

export type ConsoleDeps = {
  ctx: Ctx;
  metrics: Metrics;
  logs: LogBuffer;
  /** The always-on debug log file, offered for download. */
  logFile: string | null;
  publicUrl: () => string;
  tls: () => { mode: string; fp?: string; notAfter?: number };
  portmap: () => PortMapStatus | null;
  actions: {
    housekeeping: () => Promise<RetentionReport>;
    renewCertificate?: () => Promise<void>;
    refreshPortMapping?: () => Promise<PortMapStatus>;
  };
};
