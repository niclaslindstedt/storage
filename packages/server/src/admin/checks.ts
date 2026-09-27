// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Health checks shared by `storage-server doctor` and the admin console's
// Troubleshoot page (SPEC §11.1). Each check returns a status and, when it
// is not ok, a concrete hint. Checks never throw: a check that cannot run
// reports `fail` with the reason.

import { existsSync, statfsSync, statSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

import type { Ctx } from "../context.ts";
import { unreachableReason } from "../net/netinfo.ts";
import type { PortMapStatus } from "../net/portmap.ts";
import { discoverGateway, UpnpClient } from "../net/upnp.ts";
import { describeCertificate, readCertificatePem } from "../tls/cert-info.ts";
import type { LogBuffer } from "./log-buffer.ts";

export type CheckStatus = "ok" | "warn" | "fail" | "skip";

export type CheckResult = {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
  hint?: string;
};

export type CheckEnv = {
  ctx: Ctx;
  /** The running port mapper's state; without it, `doctor` probes the router. */
  portmap?: () => PortMapStatus | null;
  /** The running server's log buffer (enables the recent-errors check). */
  logs?: LogBuffer;
  /** Probe timeout for the public URL and the router. */
  timeoutMs?: number;
};

const GiB = 1024 ** 3;
const MiB = 1024 ** 2;

export function isLoopback(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  return (
    h === "localhost" ||
    h.endsWith(".localhost") ||
    h === "::1" ||
    /^127\.\d+\.\d+\.\d+$/.test(h)
  );
}

const size = (n: number) =>
  n >= GiB ? `${(n / GiB).toFixed(1)} GiB` : `${Math.round(n / MiB)} MiB`;

/** GET `<url>/v1/info`; resolves with the HTTP status. */
function probe(
  base: string,
  insecure: boolean,
  timeoutMs: number,
): Promise<number> {
  const url = new URL("/v1/info", base);
  const req = url.protocol === "https:" ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const r = req(
      url,
      { method: "GET", timeout: timeoutMs, rejectUnauthorized: !insecure },
      (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      },
    );
    r.on("timeout", () => r.destroy(new Error(`no answer in ${timeoutMs} ms`)));
    r.on("error", reject);
    r.end();
  });
}

type Check = (env: CheckEnv) => Promise<Omit<CheckResult, "id" | "label">>;

const CHECKS: { id: string; label: string; run: Check }[] = [
  {
    id: "data-dir",
    label: "Data directory is writable and private",
    async run({ ctx }) {
      const dir = ctx.config.dataDir;
      if (!dir) return { status: "skip", detail: "in-memory server" };
      if (!existsSync(dir))
        return {
          status: "fail",
          detail: `${dir} does not exist`,
          hint: "Check --data-dir / STORAGE_DATA_DIR.",
        };
      const mode = statSync(dir).mode & 0o777;
      if (mode & 0o077)
        return {
          status: "warn",
          detail: `${dir} has mode ${mode.toString(8)}`,
          hint: `Other users can list it; it holds the TLS key and the admin token. Run: chmod 700 ${dir}`,
        };
      return { status: "ok", detail: dir };
    },
  },
  {
    id: "database",
    label: "Database integrity",
    async run({ ctx }) {
      const r = ctx.db.get<{ quick_check: string }>("PRAGMA quick_check");
      const verdict = r?.quick_check ?? "unknown";
      return verdict === "ok"
        ? { status: "ok", detail: "quick_check passed" }
        : {
            status: "fail",
            detail: verdict,
            hint: "Stop the server and restore the latest backup (storage-server backup).",
          };
    },
  },
  {
    id: "audit-chain",
    label: "Audit log hash chain",
    async run({ ctx }) {
      const r = ctx.audit.verify();
      return r.ok
        ? { status: "ok", detail: `${r.count} entries intact` }
        : {
            status: "fail",
            detail: `broken at entry ${r.brokenAt} after ${r.count} good entries`,
            hint: "Someone edited or truncated the audit table. Treat the server as compromised: compare with a backup.",
          };
    },
  },
  {
    id: "admin-account",
    label: "An admin account exists",
    async run({ ctx }) {
      const n =
        ctx.db.get<{ n: number }>(
          "SELECT COUNT(*) AS n FROM accounts WHERE role = 'admin' AND disabled_at IS NULL",
        )?.n ?? 0;
      return n > 0
        ? { status: "ok", detail: `${n} active admin account(s)` }
        : {
            status: "fail",
            detail: "no active admin account",
            hint: "Pair a first device: storage-server setup (or Accounts → Create in the console).",
          };
    },
  },
  {
    id: "disk-space",
    label: "Free disk space",
    async run({ ctx }) {
      const dir = ctx.config.dataDir;
      if (!dir || !existsSync(dir))
        return { status: "skip", detail: "in-memory server" };
      const fs = statfsSync(dir);
      const free = fs.bavail * fs.bsize;
      const total = fs.blocks * fs.bsize;
      const detail = `${size(free)} free of ${size(total)}`;
      if (free < 256 * MiB)
        return {
          status: "fail",
          detail,
          hint: "Writes will start failing. Free space or move the data directory.",
        };
      if (free < 2 * GiB || free < total * 0.05)
        return { status: "warn", detail, hint: "Free space soon." };
      return { status: "ok", detail };
    },
  },
  {
    id: "certificate",
    label: "TLS certificate",
    async run({ ctx }) {
      const { config } = ctx;
      if (config.tls.mode === "off")
        return {
          status: "skip",
          detail: "TLS is terminated by a reverse proxy or tunnel",
        };
      const pem = readCertificatePem(config);
      if (!pem)
        return {
          status: "fail",
          detail: "no certificate yet",
          hint:
            config.tls.mode === "acme"
              ? "ACME has not succeeded. Check the logs for the challenge error; http-01 needs port 80 reachable, tls-alpn-01 port 443."
              : "Check --cert / --key, or restart to generate one.",
        };
      const c = describeCertificate(pem, ctx.clock.now());
      const detail = `${c.names} — expires ${c.notAfter.slice(0, 10)} (${c.days} days)`;
      if (c.days < 0)
        return {
          status: "fail",
          detail,
          hint: "Expired: devices will refuse to connect. Renew it (Troubleshoot → Renew certificate).",
        };
      if (c.days < 7)
        return {
          status: "warn",
          detail,
          hint:
            config.tls.mode === "acme"
              ? "Automatic renewal is failing; see the logs."
              : "Replace it soon.",
        };
      return { status: "ok", detail };
    },
  },
  {
    id: "port-mapping",
    label: "Router port mapping",
    async run({ ctx, portmap, timeoutMs = 3000 }) {
      if (!ctx.config.upnp.enabled)
        return { status: "skip", detail: "UPnP / NAT-PMP is off (--upnp)" };
      if (portmap) {
        const st = portmap();
        if (!st) return { status: "skip", detail: "not started" };
        if (!st.method)
          return {
            status: "fail",
            detail: st.error ?? "no mapping",
            hint: "Enable UPnP or NAT-PMP on the router, or forward the port by hand.",
          };
        const ports = st.mapped.map((p) => `${p.external}→${p.internal}`);
        const detail = `${st.method} ${st.externalIp ?? "?"} ${ports.join(", ")}`;
        return st.warning
          ? {
              status: "warn",
              detail: `${detail} — ${st.warning}`,
              hint: "The router's WAN address is not public; use a tunnel with --tls off.",
            }
          : { status: "ok", detail };
      }
      const gw = await discoverGateway({ timeoutMs }).catch(() => null);
      if (!gw)
        return {
          status: "fail",
          detail: "no UPnP gateway answered",
          hint: "Enable UPnP on the router (NAT-PMP is also tried while serving).",
        };
      const ip = await new UpnpClient(gw).externalIp().catch(() => null);
      const why = ip ? unreachableReason(ip) : null;
      return why
        ? { status: "warn", detail: `${ip}: ${why}` }
        : { status: "ok", detail: `gateway answers; external ${ip ?? "?"}` };
    },
  },
  {
    id: "public-url",
    label: "Public URL answers",
    async run({ ctx, timeoutMs = 8000 }) {
      const url = ctx.config.publicUrl;
      if (!url)
        return {
          status: "skip",
          detail: "no public URL configured",
          hint: "Set --public-url so QR codes carry an address devices can reach from anywhere.",
        };
      try {
        const status = await probe(
          url,
          ctx.config.tls.mode === "self-signed",
          timeoutMs,
        );
        return status === 200
          ? { status: "ok", detail: `${url} → HTTP 200` }
          : {
              status: "fail",
              detail: `${url} → HTTP ${status}`,
              hint: "Something else answers on that address (a proxy or another service).",
            };
      } catch (err) {
        return {
          status: "fail",
          detail: `${url}: ${(err as Error).message}`,
          hint: "A timeout means the port is not forwarded; a certificate error means TLS. Test from outside your network too.",
        };
      }
    },
  },
  {
    id: "exposure",
    label: "Network exposure",
    async run({ ctx }) {
      const { listen, tls, trustProxy } = ctx.config;
      const notes: string[] = [];
      if (tls.mode === "off" && !isLoopback(listen.host) && !trustProxy)
        return {
          status: "warn",
          detail: `plain HTTP on ${listen.host}:${listen.port}`,
          hint: "Without TLS, bind to 127.0.0.1 behind your TLS proxy (--host 127.0.0.1), or enable TLS.",
        };
      if (listen.adminPort !== null && !isLoopback(listen.adminHost)) {
        if (!existsSync("/.dockerenv"))
          return {
            status: "warn",
            detail: `admin console on ${listen.adminHost}:${listen.adminPort}`,
            hint: "The console speaks plain HTTP. Keep --admin-host 127.0.0.1 and use an SSH tunnel.",
          };
        notes.push(
          "admin console published by the container; map it to the host's loopback only",
        );
      }
      return {
        status: "ok",
        detail: [
          `${tls.mode === "off" ? "HTTP" : "HTTPS"} on ${listen.host}:${listen.port}`,
          ...notes,
        ].join("; "),
      };
    },
  },
  {
    id: "recent-errors",
    label: "No errors in the last hour",
    async run({ ctx, logs }) {
      if (!logs) return { status: "skip", detail: "only while serving" };
      const since = ctx.clock.now() - 3600_000;
      const errors = logs.list({ level: "error" }).filter((e) => e.at >= since);
      if (errors.length === 0) return { status: "ok", detail: "none" };
      return {
        status: "warn",
        detail: `${errors.length} error(s); latest: ${errors.at(-1)!.message}`,
        hint: "Open Logs and filter by error.",
      };
    },
  },
];

export async function runChecks(env: CheckEnv): Promise<CheckResult[]> {
  const out: CheckResult[] = [];
  for (const c of CHECKS) {
    try {
      out.push({ id: c.id, label: c.label, ...(await c.run(env)) });
    } catch (err) {
      out.push({
        id: c.id,
        label: c.label,
        status: "fail",
        detail: `check failed to run: ${(err as Error).message}`,
      });
    }
  }
  return out;
}
