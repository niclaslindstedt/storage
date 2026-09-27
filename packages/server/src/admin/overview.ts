// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// What the admin console's Overview page and the Prometheus endpoint report:
// process, storage, counts, TLS, traffic and health. Only what the server
// already sees (SPEC §4.1) — counts and sizes, never content or names of
// user data.

import { existsSync, statfsSync, statSync } from "node:fs";
import { loadavg } from "node:os";
import { join } from "node:path";

import type { Ctx } from "../context.ts";
import { describeCertificate, readCertificatePem } from "../tls/cert-info.ts";
import { VERSION } from "../version.ts";
import type { CheckResult } from "./checks.ts";
import type { ConsoleDeps } from "./console.ts";

export type Counts = {
  accounts: number;
  admins: number;
  disabledAccounts: number;
  devices: number;
  pendingDevices: number;
  revokedDevices: number;
  namespaces: number;
  files: number;
  records: number;
  pendingInvites: number;
  activePairings: number;
};

export function counts(ctx: Ctx): Counts {
  const now = ctx.clock.now();
  const n = (sql: string, ...args: (string | number)[]) =>
    ctx.db.get<{ n: number }>(sql, ...args)?.n ?? 0;
  return {
    accounts: n("SELECT COUNT(*) AS n FROM accounts"),
    admins: n(
      "SELECT COUNT(*) AS n FROM accounts WHERE role = 'admin' AND disabled_at IS NULL",
    ),
    disabledAccounts: n(
      "SELECT COUNT(*) AS n FROM accounts WHERE disabled_at IS NOT NULL",
    ),
    devices: n(
      "SELECT COUNT(*) AS n FROM devices WHERE revoked_at IS NULL AND device_wrap IS NOT NULL",
    ),
    pendingDevices: n(
      "SELECT COUNT(*) AS n FROM devices WHERE revoked_at IS NULL AND device_wrap IS NULL",
    ),
    revokedDevices: n(
      "SELECT COUNT(*) AS n FROM devices WHERE revoked_at IS NOT NULL",
    ),
    namespaces: n(
      "SELECT COUNT(*) AS n FROM namespaces WHERE deleted_at IS NULL",
    ),
    files: n("SELECT COUNT(*) AS n FROM files WHERE blob_hash IS NOT NULL"),
    records: n("SELECT COUNT(*) AS n FROM records WHERE value IS NOT NULL"),
    pendingInvites: n(
      "SELECT COUNT(*) AS n FROM invites WHERE revoked_at IS NULL AND uses < max_uses AND expires_at > ?",
      now,
    ),
    activePairings: n(
      "SELECT COUNT(*) AS n FROM pairings WHERE used_at IS NULL AND expires_at > ?",
      now,
    ),
  };
}

export type StorageStats = {
  dataDir: string | null;
  databaseBytes: number;
  blobBytes: number;
  blobCount: number;
  diskFreeBytes: number | null;
  diskTotalBytes: number | null;
};

export function storageStats(ctx: Ctx): StorageStats {
  const dir = ctx.config.dataDir;
  let databaseBytes = 0;
  let diskFreeBytes: number | null = null;
  let diskTotalBytes: number | null = null;
  if (dir) {
    for (const f of ["storage.db", "storage.db-wal"]) {
      const p = join(dir, f);
      if (existsSync(p)) databaseBytes += statSync(p).size;
    }
    try {
      const fs = statfsSync(dir);
      diskFreeBytes = fs.bavail * fs.bsize;
      diskTotalBytes = fs.blocks * fs.bsize;
    } catch {
      // statfs is unavailable on some platforms; the console shows "—"
    }
  } else {
    const page = ctx.db.get<{ n: number }>("PRAGMA page_count")?.n ?? 0;
    const size = ctx.db.get<{ n: number }>("PRAGMA page_size")?.n ?? 0;
    databaseBytes = page * size;
  }
  const blobs = ctx.db.get<{ bytes: number; n: number }>(
    "SELECT COALESCE(SUM(size), 0) AS bytes, COUNT(*) AS n FROM blobs",
  );
  return {
    dataDir: dir,
    databaseBytes,
    blobBytes: blobs?.bytes ?? 0,
    blobCount: blobs?.n ?? 0,
    diskFreeBytes,
    diskTotalBytes,
  };
}

export type TlsSummary = {
  mode: string;
  fp: string | null;
  notAfter: string | null;
  daysLeft: number | null;
  names: string | null;
};

export function tlsSummary(deps: ConsoleDeps): TlsSummary {
  const live = deps.tls();
  const pem = readCertificatePem(deps.ctx.config);
  const cert = pem ? describeCertificate(pem, deps.ctx.clock.now()) : null;
  const notAfter = live.notAfter
    ? new Date(live.notAfter).toISOString()
    : (cert?.notAfter ?? null);
  return {
    mode: live.mode,
    fp: live.fp ?? cert?.fp ?? null,
    notAfter,
    daysLeft: notAfter
      ? Math.floor((Date.parse(notAfter) - deps.ctx.clock.now()) / 86400_000)
      : null,
    names: cert?.names ?? null,
  };
}

export type Health = {
  status: "ok" | "warn" | "fail";
  checkedAt: number;
  problems: CheckResult[];
};

export function health(results: CheckResult[], at: number): Health {
  const problems = results.filter(
    (r) => r.status === "fail" || r.status === "warn",
  );
  return {
    status: problems.some((r) => r.status === "fail")
      ? "fail"
      : problems.length
        ? "warn"
        : "ok",
    checkedAt: at,
    problems,
  };
}

export function serverInfo(deps: ConsoleDeps) {
  const mem = process.memoryUsage();
  return {
    name: deps.ctx.config.name,
    version: VERSION,
    serverId: deps.ctx.serverId,
    startedAt: deps.metrics.since,
    uptimeSeconds: Math.max(
      0,
      Math.round((deps.ctx.clock.now() - deps.metrics.since) / 1000),
    ),
    node: process.version,
    platform: `${process.platform} ${process.arch}`,
    pid: process.pid,
    memory: { rss: mem.rss, heapUsed: mem.heapUsed },
    load: loadavg(),
  };
}

/** Gauges for `/metrics`, beside the request counters and histogram. */
export function gauges(
  deps: ConsoleDeps,
  auditOk: boolean,
): Record<string, number> {
  const c = counts(deps.ctx);
  const s = storageStats(deps.ctx);
  const tls = tlsSummary(deps);
  const out: Record<string, number> = {
    storage_up_seconds: serverInfo(deps).uptimeSeconds,
    storage_accounts: c.accounts,
    storage_devices: c.devices,
    storage_devices_pending: c.pendingDevices,
    storage_namespaces: c.namespaces,
    storage_blob_bytes: s.blobBytes,
    storage_database_bytes: s.databaseBytes,
    storage_audit_chain_ok: auditOk ? 1 : 0,
    storage_log_errors: deps.logs.counts().error,
    storage_log_warnings: deps.logs.counts().warn,
  };
  if (s.diskFreeBytes !== null) out.storage_disk_free_bytes = s.diskFreeBytes;
  if (tls.notAfter)
    out.storage_cert_expiry_seconds = Math.round(
      (Date.parse(tls.notAfter) - deps.ctx.clock.now()) / 1000,
    );
  return out;
}
