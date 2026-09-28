// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The admin console's JSON API (SPEC §11.1). Authentication and CSRF are
// handled by console.ts; handlers here validate input, call the same
// services the CLI uses, and audit every change with actor "admin-console".

import { createReadStream, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Readable } from "node:stream";

import { writeBackup } from "../backup.ts";
import { ApiError, badRequest, conflict, notFound } from "../errors.ts";
import { appLink, pairingUri } from "../payload.ts";
import { encodeQr } from "../qr/encode.ts";
import { qrToSvg } from "../qr/render.ts";
import {
  type Account,
  createAccount,
  deleteAccount,
  getAccount,
  listAccounts,
  updateAccount,
} from "../services/accounts.ts";
import {
  dropConsoleAccess,
  narrowScope,
  revokeDevice,
} from "../services/devices.ts";
import { createPairing } from "../services/pairing.ts";
import {
  type AgentScope,
  intersect,
  parseScope,
  readScope,
} from "../services/scope.ts";
import { getSettings, updateSettings } from "../services/settings.ts";
import { type CheckResult, runChecks } from "./checks.ts";
import type { ConsoleDeps } from "./deps.ts";
import { LOG_LEVELS, type LogEntry, type LogLevel } from "./log-buffer.ts";
import {
  counts,
  gauges,
  health,
  serverInfo,
  storageStats,
  tlsSummary,
} from "./overview.ts";

const CHECK_TTL_MS = 5 * 60_000;
const AUDIT_TTL_MS = 30_000;

export type ApiRequest = {
  params: Record<string, string>;
  query: URLSearchParams;
  ip: string;
  /** Who the audit log names: "admin-console", or the admin device's id. */
  actor: string;
  /** Reached through the device API by an admin device (SPEC §11.2). */
  remote: boolean;
  /**
   * The calling admin device's agent scope (SPEC §11.4), or null. Pairings
   * a scoped device mints are never wider than the device itself.
   */
  scope: AgentScope | null;
  body(): Promise<Record<string, unknown>>;
};

/** The actor the local console's changes are audited under. */
export const LOCAL_ACTOR = "admin-console";

export type ApiResult = {
  status?: number;
  json?: unknown;
  text?: string;
  type?: string;
  headers?: Record<string, string>;
  stream?: Readable;
  /** Server-sent events: start, return a stop function. */
  sse?: (send: (event: string, data: unknown) => void) => () => void;
};

type Handler = (req: ApiRequest) => Promise<ApiResult> | ApiResult;

export type ConsoleState = {
  deps: ConsoleDeps;
  checks: { at: number; results: CheckResult[] } | null;
  auditCache: { at: number; ok: boolean; count: number } | null;
  /** Re-run the checks in the background (set by apiRoutes). */
  refreshChecks?: () => Promise<{ at: number; results: CheckResult[] }>;
};

export class Routes {
  private readonly table: {
    method: string;
    parts: string[];
    handler: Handler;
  }[] = [];

  add(method: string, pattern: string, handler: Handler): this {
    this.table.push({
      method,
      parts: pattern.split("/").filter(Boolean),
      handler,
    });
    return this;
  }

  match(
    method: string,
    path: string,
  ):
    | { handler: Handler; params: Record<string, string> }
    | { methods: string[] }
    | null {
    const segs = path.split("/").filter(Boolean);
    const methods: string[] = [];
    for (const r of this.table) {
      if (r.parts.length !== segs.length) continue;
      const params: Record<string, string> = {};
      const ok = r.parts.every((p, i) => {
        if (p.startsWith(":")) {
          params[p.slice(1)] = decodeURIComponent(segs[i]!);
          return true;
        }
        return p === segs[i];
      });
      if (!ok) continue;
      if (r.method === method) return { handler: r.handler, params };
      methods.push(r.method);
    }
    return methods.length ? { methods } : null;
  }
}

// ---------------------------------------------------------------- inputs

function str(body: Record<string, unknown>, key: string): string | undefined {
  const v = body[key];
  if (v === undefined) return undefined;
  if (typeof v !== "string") throw badRequest(`${key} must be a string`);
  return v;
}

function role(v: unknown): Account["role"] | undefined {
  if (v === undefined) return undefined;
  if (v === "admin" || v === "member" || v === "guest") return v;
  throw badRequest("role must be admin, member or guest");
}

function quota(v: unknown): number | null | undefined {
  if (v === undefined || v === null) return v;
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 0)
    throw badRequest("quotaBytes must be a non-negative integer or null");
  return v;
}

function int(q: URLSearchParams, key: string, dflt: number, max: number) {
  const raw = q.get(key);
  if (raw === null || raw === "") return dflt;
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n < 0) throw badRequest(`${key} is invalid`);
  return Math.min(n, max);
}

function level(q: URLSearchParams): LogLevel | undefined {
  const v = q.get("level");
  if (!v) return undefined;
  if (!LOG_LEVELS.includes(v as LogLevel))
    throw badRequest(`level must be one of ${LOG_LEVELS.join(", ")}`);
  return v as LogLevel;
}

// ---------------------------------------------------------------- routes

/** One console API, shared by the local listener and the remote console. */
export type ConsoleApi = { state: ConsoleState; routes: Routes };

export function createConsoleApi(deps: ConsoleDeps): ConsoleApi {
  const state: ConsoleState = { deps, checks: null, auditCache: null };
  return { state, routes: apiRoutes(state) };
}

export function apiRoutes(state: ConsoleState): Routes {
  const { deps } = state;
  const { ctx } = deps;
  const routes = new Routes();
  /** Console changes are audited by the services and noted in the log. */
  const note = (message: string, req: ApiRequest) =>
    ctx.log.info(
      req.remote
        ? `admin console (remote, ${req.actor}): ${message}`
        : `admin console: ${message}`,
    );

  let inflight: Promise<{ at: number; results: CheckResult[] }> | null = null;
  state.refreshChecks = () => {
    inflight ??= runChecks({
      ctx,
      portmap: () => deps.portmap(),
      logs: deps.logs,
    })
      .then((results) => (state.checks = { at: ctx.clock.now(), results }))
      .finally(() => (inflight = null));
    return inflight;
  };
  async function checks() {
    const c = state.checks;
    if (!c) return state.refreshChecks!();
    if (ctx.clock.now() - c.at > CHECK_TTL_MS) void state.refreshChecks!();
    return c;
  }
  function audit() {
    const c = state.auditCache;
    if (c && ctx.clock.now() - c.at < AUDIT_TTL_MS) return c;
    const v = ctx.audit.verify();
    return (state.auditCache = {
      at: ctx.clock.now(),
      ok: v.ok,
      count: v.count,
    });
  }

  /**
   * The scope of a pairing minted by `req`: what was asked for, narrowed to
   * a scoped caller's own scope without its console permissions (a device
   * never mints a wider device, nor an admin device).
   */
  function inherit(
    req: ApiRequest,
    asked: AgentScope | undefined,
  ): AgentScope | undefined {
    if (!req.scope) return asked;
    const own = intersect(asked ?? req.scope, req.scope);
    return {
      perms: own.perms.filter((p) => !p.startsWith("console:")),
      apps: own.apps,
    };
  }

  function pairing(created: { code?: string; expiresAt: number }) {
    const tls = deps.tls();
    const uri = pairingUri({
      server: deps.publicUrl(),
      code: created.code!,
      name: ctx.config.name,
      fp: tls.mode === "self-signed" ? tls.fp : undefined,
    });
    const payload = ctx.config.appUrl ? appLink(ctx.config.appUrl, uri) : uri;
    return {
      json: {
        payload,
        svg: qrToSvg(encodeQr(payload), { moduleSize: 6 }),
        expiresAt: created.expiresAt,
      },
    };
  }

  function recentProblems(): LogEntry[] {
    return deps.logs.list({ level: "warn", limit: 8 }).reverse();
  }

  async function overview() {
    const c = await checks();
    const a = audit();
    return {
      server: serverInfo(deps),
      urls: {
        public: deps.publicUrl(),
        publicConfigured: ctx.config.publicUrl !== null,
      },
      tls: tlsSummary(deps),
      portMapping: ctx.config.upnp.enabled ? deps.portmap() : null,
      storage: storageStats(ctx),
      counts: counts(ctx),
      traffic: {
        totals: deps.metrics.totals(),
        latency: deps.metrics.latency(),
        sseConnections: deps.metrics.sseConnections,
        series: deps.metrics.series(),
      },
      logs: deps.logs.counts(),
      audit: { ok: a.ok, entries: a.count, head: ctx.audit.head() },
      health: health(c.results, c.at),
      recent: {
        problems: recentProblems(),
        audit: auditPage(undefined, 8, undefined),
      },
    };
  }

  function auditPage(
    before: number | undefined,
    limit: number,
    action: string | undefined,
  ) {
    const rows = ctx.db.all<{
      id: number;
      at: number;
      actor: string | null;
      action: string;
      target: string | null;
      ip: string | null;
      detail: string | null;
    }>(
      `SELECT id, at, actor, action, target, ip, detail FROM audit
       WHERE id < ? AND (? IS NULL OR action = ? OR action LIKE ? || '.%')
       ORDER BY id DESC LIMIT ?`,
      before ?? Number.MAX_SAFE_INTEGER,
      action ?? null,
      action ?? null,
      action ?? null,
      limit,
    );
    return rows.map((r) => ({
      ...r,
      detail: r.detail ? (JSON.parse(r.detail) as unknown) : null,
    }));
  }

  function redactedConfig() {
    const c = structuredClone(ctx.config) as Record<string, unknown>;
    if (c.testSecret) c.testSecret = "(redacted)";
    return c;
  }

  // -- overview & monitoring

  routes.add("GET", "/api/overview", async () => ({ json: await overview() }));

  routes.add("GET", "/api/metrics", () => ({
    json: {
      series: deps.metrics.series(),
      routes: deps.metrics.routes(),
      totals: deps.metrics.totals(),
      latency: deps.metrics.latency(),
      sseConnections: deps.metrics.sseConnections,
    },
  }));

  routes.add("GET", "/metrics", () => ({
    text: deps.metrics.prometheus(gauges(deps, audit().ok)),
    type: "text/plain; version=0.0.4; charset=utf-8",
  }));

  // -- accounts & pairing

  routes.add("GET", "/api/accounts", () => {
    const perAccount = (sql: string) =>
      new Map(
        ctx.db
          .all<{ id: string; n: number }>(sql)
          .map((r) => [r.id, r.n] as const),
      );
    const devices = perAccount(
      "SELECT account_id AS id, COUNT(*) AS n FROM devices WHERE revoked_at IS NULL GROUP BY account_id",
    );
    const owned = perAccount(
      "SELECT owner_account_id AS id, COUNT(*) AS n FROM namespaces WHERE deleted_at IS NULL GROUP BY owner_account_id",
    );
    const seen = perAccount(
      "SELECT account_id AS id, MAX(last_seen_at) AS n FROM devices GROUP BY account_id",
    );
    return {
      json: listAccounts(ctx).map((a) => ({
        ...a,
        devices: devices.get(a.id) ?? 0,
        namespaces: owned.get(a.id) ?? 0,
        lastSeenAt: seen.get(a.id) ?? null,
      })),
    };
  });

  routes.add("POST", "/api/accounts", async (req) => {
    const b = await req.body();
    const created = createAccount(
      ctx,
      {
        name: str(b, "name") ?? "",
        role: role(b.role) ?? "member",
        quotaBytes: quota(b.quotaBytes),
      },
      req.actor,
    );
    note(`created ${created.role} account ${created.id}`, req);
    return { status: 201, json: created };
  });

  routes.add("PATCH", "/api/accounts/:id", async (req) => {
    const b = await req.body();
    if (b.disabled !== undefined && typeof b.disabled !== "boolean")
      throw badRequest("disabled must be a boolean");
    return {
      json: updateAccount(
        ctx,
        req.params.id!,
        {
          name: str(b, "name"),
          role: role(b.role),
          quotaBytes: quota(b.quotaBytes),
          disabled: b.disabled as boolean | undefined,
        },
        req.actor,
      ),
    };
  });

  routes.add("DELETE", "/api/accounts/:id", async (req) => {
    const account = getAccount(ctx, req.params.id!);
    if (!account) throw notFound("no such account");
    const b = await req.body();
    if (b.confirm !== account.name)
      throw badRequest(
        `type the account name (${account.name}) in "confirm" to delete it and every namespace it owns`,
      );
    await deleteAccount(ctx, account.id, req.actor);
    note(`deleted account ${account.id}`, req);
    return { json: { deleted: account.id } };
  });

  routes.add("POST", "/api/accounts/:id/pairing", async (req) => {
    const b = await req.body();
    if (b.console !== undefined && typeof b.console !== "boolean")
      throw badRequest("console must be a boolean");
    // Remote admin access is granted at the machine only (SPEC §11.2): an
    // admin device can pair ordinary devices, never another admin device.
    if (b.console && req.remote)
      throw new ApiError(
        403,
        "forbidden",
        "admin devices are paired from the local console or the CLI",
      );
    // An agent device (SPEC §11.4): `agent: {perms, apps}` scopes it.
    const scope = inherit(
      req,
      b.agent === undefined || b.agent === null
        ? undefined
        : parseScope(b.agent),
    );
    return pairing(
      createPairing(
        ctx,
        { accountId: req.params.id!, console: b.console === true, scope },
        req.actor,
      ),
    );
  });

  routes.add("POST", "/api/pairing", async (req) => {
    const b = await req.body();
    return pairing(
      createPairing(
        ctx,
        {
          newAccount: {
            name: str(b, "name") ?? "",
            role: role(b.role) ?? "member",
          },
          scope: inherit(req, undefined),
        },
        req.actor,
      ),
    );
  });

  // -- devices & namespaces

  routes.add("GET", "/api/devices", () => ({
    json: ctx.db
      .all<{
        id: string;
        name: string;
        platform: string;
        account_id: string;
        account: string;
        origin: string | null;
        created_at: number;
        last_seen_at: number | null;
        revoked_at: number | null;
        has_key: number;
        console: number;
        scope: string | null;
      }>(
        `SELECT d.id, d.name, d.platform, d.account_id, a.name AS account, d.origin,
                d.created_at, d.last_seen_at, d.revoked_at,
                d.device_wrap IS NOT NULL AS has_key, d.console, d.scope
         FROM devices d JOIN accounts a ON a.id = d.account_id
         ORDER BY a.name COLLATE NOCASE, d.created_at`,
      )
      .map((d) => ({
        id: d.id,
        name: d.name,
        platform: d.platform,
        accountId: d.account_id,
        account: d.account,
        origin: d.origin,
        createdAt: d.created_at,
        lastSeenAt: d.last_seen_at,
        revokedAt: d.revoked_at,
        state: d.revoked_at ? "revoked" : d.has_key ? "active" : "pending",
        console: d.console === 1 && !d.revoked_at,
        agent: readScope(d.scope),
      })),
  }));

  // Only ever takes access away: console access (SPEC §11.2) or part of an
  // agent's scope (§11.4). Granting either is a pairing made at the machine.
  routes.add("PATCH", "/api/devices/:id", async (req) => {
    const b = await req.body();
    const keys = Object.keys(b);
    if (
      keys.length === 0 ||
      keys.some((k) => k !== "console" && k !== "agent") ||
      (b.console !== undefined && b.console !== false)
    )
      throw badRequest(
        "only { console: false } and { agent: {perms, apps} } (narrower) are accepted: pair a new device to grant access",
      );
    const id = req.params.id!;
    let device = null;
    if (b.agent !== undefined) {
      device = narrowScope(ctx, id, parseScope(b.agent), req.ip, req.actor);
      note(`narrowed the scope of device ${id}`, req);
    }
    if (b.console === false) {
      device = dropConsoleAccess(ctx, id, req.ip, req.actor);
      note(`removed console access from device ${id}`, req);
    }
    return {
      json: { id: device!.id, console: device!.console, agent: device!.agent },
    };
  });

  routes.add("DELETE", "/api/devices/:id", (req) => {
    revokeDevice(ctx, null, req.params.id!, req.ip, req.actor);
    note(`revoked device ${req.params.id}`, req);
    return { json: { revoked: req.params.id } };
  });

  routes.add("GET", "/api/namespaces", () => {
    const now = ctx.clock.now();
    const rows = ctx.db.all<{
      id: string;
      app: string;
      owner: string;
      used_bytes: number;
      seq: number;
      epoch: number;
      created_at: number;
      invites: number;
    }>(
      `SELECT n.id, n.app, a.name AS owner, n.used_bytes, n.seq, n.epoch, n.created_at,
              (SELECT COUNT(*) FROM invites i WHERE i.namespace_id = n.id AND i.revoked_at IS NULL
                 AND i.uses < i.max_uses AND i.expires_at > ?) AS invites
       FROM namespaces n JOIN accounts a ON a.id = n.owner_account_id
       WHERE n.deleted_at IS NULL ORDER BY a.name COLLATE NOCASE, n.app, n.created_at`,
      now,
    );
    const members = ctx.db.all<{ ns: string; name: string; role: string }>(
      `SELECT m.namespace_id AS ns, a.name, m.role FROM members m
       JOIN accounts a ON a.id = m.account_id ORDER BY m.created_at`,
    );
    return {
      json: rows.map((r) => ({
        id: r.id,
        app: r.app,
        owner: r.owner,
        members: members
          .filter((m) => m.ns === r.id)
          .map(({ name, role }) => ({ name, role })),
        usedBytes: r.used_bytes,
        seq: r.seq,
        epoch: r.epoch,
        createdAt: r.created_at,
        pendingInvites: r.invites,
      })),
    };
  });

  // -- logs & audit

  routes.add("GET", "/api/logs", (req) => ({
    json: {
      entries: deps.logs.list({
        after: int(req.query, "after", 0, Number.MAX_SAFE_INTEGER),
        level: level(req.query),
        q: req.query.get("q") ?? undefined,
        limit: int(req.query, "limit", 500, 2000),
      }),
      counts: deps.logs.counts(),
    },
  }));

  routes.add("GET", "/api/logs/stream", (req) => {
    const after = int(req.query, "after", 0, Number.MAX_SAFE_INTEGER);
    return {
      sse(send) {
        for (const e of deps.logs.list({ after })) send("log", e);
        return deps.logs.subscribe((e) => send("log", e));
      },
    };
  });

  routes.add("GET", "/api/logs/file", () => {
    const file = deps.logFile;
    if (!file || !existsSync(file)) throw notFound("no debug log file");
    const size = statSync(file).size;
    const start = Math.max(0, size - 5 * 1024 * 1024);
    return {
      stream: createReadStream(file, { start }),
      type: "text/plain; charset=utf-8",
      headers: {
        "Content-Disposition": 'attachment; filename="storage-debug.log"',
      },
    };
  });

  routes.add("GET", "/api/audit", (req) => {
    const before = req.query.get("before");
    return {
      json: {
        entries: auditPage(
          before
            ? int(req.query, "before", 0, Number.MAX_SAFE_INTEGER)
            : undefined,
          int(req.query, "limit", 100, 500),
          req.query.get("action") || undefined,
        ),
      },
    };
  });

  routes.add("POST", "/api/audit/verify", () => {
    state.auditCache = null;
    const v = ctx.audit.verify();
    audit();
    return { json: { ...v, head: ctx.audit.head() } };
  });

  // -- troubleshooting

  routes.add("GET", "/api/checks", async () => {
    const c = await state.refreshChecks!();
    return { json: c };
  });

  routes.add("GET", "/api/config", () => ({ json: redactedConfig() }));

  // -- settings: version history and trash (runtime, over the config)

  routes.add("GET", "/api/settings", () => ({ json: getSettings(ctx) }));

  routes.add("PATCH", "/api/settings", async (req) => {
    const out = updateSettings(ctx, await req.body(), {
      actor: req.actor,
      ip: req.ip,
    });
    return { json: out };
  });

  routes.add("POST", "/api/actions/housekeeping", async (req) => {
    const report = await deps.actions.housekeeping();
    note(`housekeeping ${JSON.stringify(report)}`, req);
    ctx.audit.append({
      actor: req.actor,
      action: "admin.housekeeping",
      detail: report,
    });
    return { json: report };
  });

  routes.add("POST", "/api/actions/renew-certificate", async (req) => {
    if (ctx.config.tls.mode !== "acme" || !deps.actions.renewCertificate)
      throw conflict("certificates are renewed only in --tls acme mode");
    await deps.actions.renewCertificate();
    note("renewed the certificate", req);
    ctx.audit.append({ actor: req.actor, action: "admin.renew-certificate" });
    return { json: tlsSummary(deps) };
  });

  routes.add("POST", "/api/actions/refresh-port-mapping", async (req) => {
    if (!ctx.config.upnp.enabled || !deps.actions.refreshPortMapping)
      throw conflict("port mapping is off (--upnp)");
    const status = await deps.actions.refreshPortMapping();
    note(`port mapping refreshed (${status.method ?? status.error})`, req);
    ctx.audit.append({
      actor: req.actor,
      action: "admin.refresh-port-mapping",
    });
    return { json: status };
  });

  routes.add("POST", "/api/actions/backup", (req) => {
    const dir = ctx.config.dataDir;
    if (!dir) throw conflict("an in-memory server has nothing to back up");
    const stamp = new Date(ctx.clock.now()).toISOString().replace(/[:.]/g, "-");
    try {
      const path = writeBackup(ctx, join(dir, "backups", stamp));
      note(`backup written to ${path}`, req);
      return { json: { path } };
    } catch (err) {
      throw new ApiError(500, "backup_failed", (err as Error).message);
    }
  });

  routes.add("GET", "/api/diagnostics", async () => {
    const stamp = new Date(ctx.clock.now()).toISOString().replace(/[:.]/g, "-");
    const bundle = {
      generatedAt: new Date(ctx.clock.now()).toISOString(),
      overview: await overview(),
      checks: (await checks()).results,
      config: redactedConfig(),
      metrics: {
        routes: deps.metrics.routes(),
        totals: deps.metrics.totals(),
        latency: deps.metrics.latency(),
        series: deps.metrics.series(),
      },
      logs: deps.logs.list({ limit: 500 }),
    };
    return {
      text: JSON.stringify(bundle, null, 2),
      type: "application/json; charset=utf-8",
      headers: {
        "Content-Disposition": `attachment; filename="storage-diagnostics-${stamp}.json"`,
      },
    };
  });

  return routes;
}
