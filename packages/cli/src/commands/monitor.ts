// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// `status`, `traffic`, `metrics`, `logs`, `audit`, `doctor`, `system` and
// `api`: the console's Overview, Traffic, Logs, Audit and Troubleshoot
// pages, and raw access to its API.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type {
  AuditEntry,
  CheckResult,
  LogEntry,
  Metrics,
  Overview,
  PortMapStatus,
} from "../../../server/src/admin/ui/types.ts";
import { UsageError } from "../args.ts";
import type { Cli } from "../cli.ts";
import { parseJson } from "../client.ts";
import { readEvents } from "../http.ts";
import {
  bytes,
  duration,
  pairs,
  renderTemplate,
  type Style,
  table,
  when,
} from "../output.ts";
import { EXIT } from "../spec.ts";

function checkMark(s: Style, status: CheckResult["status"]): string {
  return status === "ok"
    ? s.green("✓")
    : status === "warn"
      ? s.yellow("!")
      : status === "fail"
        ? s.red("✗")
        : s.dim("-");
}

function levelLabel(s: Style, level: LogEntry["level"]): string {
  const l = level.padEnd(5);
  return level === "error"
    ? s.red(l)
    : level === "warn"
      ? s.yellow(l)
      : level === "debug"
        ? s.dim(l)
        : l;
}

function logLine(cli: Cli, e: LogEntry): string {
  const at = cli.tty
    ? new Date(e.at).toLocaleTimeString("en-GB", { hour12: false })
    : new Date(e.at).toISOString();
  return `${cli.style.dim(at)} ${levelLabel(cli.style, e.level)} ${e.message}`;
}

function portMapping(p: PortMapStatus | null): string {
  if (!p) return "off";
  if (p.error) return `failing: ${p.error}`;
  const maps = p.mapped.map((m) => `${m.external}→${m.internal}`).join(", ");
  return [p.method, p.externalIp, maps, p.warning].filter(Boolean).join(" · ");
}

// ---------------------------------------------------------------- status

export async function status(cli: Cli): Promise<number> {
  const o = await cli.client().get<Overview>("/api/overview");
  const code = o.health.status === "fail" ? EXIT.failure : EXIT.ok;
  if (cli.bool("json")) {
    cli.out(JSON.stringify(o, null, 2));
    return code;
  }
  const s = cli.style;
  const verdict =
    o.health.status === "ok"
      ? s.green("● healthy")
      : o.health.status === "warn"
        ? s.yellow("● needs attention")
        : s.red("● failing");
  const c = o.counts;
  const t = o.traffic;
  cli.out(
    `${s.bold(o.server.name)}  storage-server ${o.server.version}  ${verdict}`,
  );
  cli.out(
    pairs(
      [
        [
          "uptime",
          `${duration(o.server.uptimeSeconds)} (node ${o.server.node}, ${o.server.platform}, pid ${o.server.pid}, rss ${bytes(o.server.memory.rss)})`,
        ],
        [
          "public url",
          `${o.urls.public}${o.urls.publicConfigured ? "" : s.dim(" (guessed: set --public-url)")}`,
        ],
        [
          "tls",
          [
            o.tls.mode,
            o.tls.names,
            o.tls.daysLeft !== null
              ? `expires in ${o.tls.daysLeft} days`
              : null,
            o.tls.fp ? `fp ${o.tls.fp}` : null,
          ]
            .filter(Boolean)
            .join(" · "),
        ],
        ["port mapping", portMapping(o.portMapping)],
        [
          "storage",
          `database ${bytes(o.storage.databaseBytes)} · blobs ${bytes(o.storage.blobBytes)} (${o.storage.blobCount}) · disk free ${bytes(o.storage.diskFreeBytes)}${o.storage.diskTotalBytes ? ` of ${bytes(o.storage.diskTotalBytes)}` : ""}`,
        ],
        [
          "accounts",
          `${c.accounts} (${c.admins} admin, ${c.disabledAccounts} disabled)`,
        ],
        [
          "devices",
          `${c.devices} (${c.pendingDevices} pending, ${c.revokedDevices} revoked)`,
        ],
        [
          "namespaces",
          `${c.namespaces} · ${c.files} files · ${c.records} records · ${c.pendingInvites} pending invites · ${c.activePairings} open pairings`,
        ],
        [
          "traffic",
          `${t.totals.requests} requests · ${t.totals.clientErrors} 4xx · ${t.totals.serverErrors} 5xx · ${t.totals.rateLimited} rate limited · p50 ${t.latency.p50} ms, p95 ${t.latency.p95} ms, p99 ${t.latency.p99} ms · ${t.sseConnections} live`,
        ],
        ["logs", `${o.logs.warn} warnings · ${o.logs.error} errors`],
        [
          "audit",
          o.audit.ok
            ? `${s.green("✓")} chain intact (${o.audit.entries} entries)`
            : `${s.red("✗")} chain broken — run \`storage audit verify\``,
        ],
      ],
      s,
    ),
  );
  if (o.health.problems.length) {
    cli.out(
      `\n${s.bold("Problems")} ${s.dim(`(checked ${when(o.health.checkedAt, cli.tty, cli.now())})`)}`,
    );
    for (const p of o.health.problems) {
      cli.out(`  ${checkMark(s, p.status)} ${p.label}: ${p.detail}`);
      if (p.hint) cli.out(`    ${s.dim(p.hint)}`);
    }
  }
  if (o.recent.problems.length) {
    cli.out(`\n${s.bold("Recent log problems")}`);
    for (const e of o.recent.problems) cli.out(`  ${logLine(cli, e)}`);
  }
  return code;
}

// ---------------------------------------------------------------- traffic

export async function traffic(cli: Cli): Promise<number> {
  const m = await cli.client().get<Metrics>("/api/metrics");
  if (cli.bool("json")) return (cli.out(JSON.stringify(m, null, 2)), EXIT.ok);
  const s = cli.style;
  cli.out(
    pairs(
      [
        ["since", when(m.totals.since, cli.tty, cli.now())],
        [
          "requests",
          `${m.totals.requests} (${m.totals.clientErrors} 4xx, ${m.totals.serverErrors} 5xx, ${m.totals.rateLimited} rate limited)`,
        ],
        [
          "latency",
          `p50 ${m.latency.p50} ms · p95 ${m.latency.p95} ms · p99 ${m.latency.p99} ms`,
        ],
        ["live sse", String(m.sseConnections)],
      ],
      s,
    ),
  );
  const minutes = m.series.slice(-Math.max(1, cli.int("minutes", 15)));
  cli.out(`\n${s.bold("Per minute")}`);
  cli.out(
    table(
      minutes,
      [
        {
          header: "minute",
          value: (b) =>
            cli.tty
              ? new Date(b.at).toLocaleTimeString("en-GB", {
                  hour: "2-digit",
                  minute: "2-digit",
                })
              : new Date(b.at).toISOString(),
        },
        { header: "requests", value: (b) => String(b.requests) },
        { header: "4xx", value: (b) => String(b.clientErrors) },
        {
          header: "5xx",
          value: (b) => (b.serverErrors ? s.red(String(b.serverErrors)) : "0"),
        },
        { header: "limited", value: (b) => String(b.rateLimited) },
        { header: "p50 ms", value: (b) => String(b.p50) },
        { header: "p95 ms", value: (b) => String(b.p95) },
      ],
      cli.tty,
    ),
  );
  if (m.routes.length) {
    cli.out(`\n${s.bold("Routes")}`);
    cli.out(
      table(
        [...m.routes].sort((a, b) => b.count - a.count),
        [
          { header: "method", value: (r) => r.method },
          { header: "route", value: (r) => r.route },
          { header: "count", value: (r) => String(r.count) },
          { header: "4xx", value: (r) => String(r.clientErrors) },
          { header: "5xx", value: (r) => String(r.serverErrors) },
          { header: "avg ms", value: (r) => String(Math.round(r.avgMs)) },
          { header: "max ms", value: (r) => String(Math.round(r.maxMs)) },
        ],
        cli.tty,
      ),
    );
  }
  return EXIT.ok;
}

export async function metrics(cli: Cli): Promise<number> {
  const res = await cli.client().call("GET", "/metrics");
  cli.out(res.body.toString("utf8").replace(/\n$/, ""));
  return EXIT.ok;
}

// ---------------------------------------------------------------- logs

const LEVELS = ["debug", "info", "warn", "error"] as const;

export async function logs(cli: Cli, sub: string): Promise<number> {
  const client = cli.client();
  if (sub === "download") {
    const res = await client.call("GET", "/api/logs/file");
    const path = cli.save(cli.str("output") ?? "storage-debug.log", res.body);
    if (path)
      cli.ok(`Saved the debug log (${bytes(res.body.length)}) to ${path}`);
    return EXIT.ok;
  }
  const level = cli.str("level");
  if (level && !(LEVELS as readonly string[]).includes(level))
    throw new UsageError("--level must be debug, info, warn or error");
  const q = cli.str("grep");
  const min = level ? LEVELS.indexOf(level as LogEntry["level"]) : 0;
  const matches = (e: LogEntry) =>
    LEVELS.indexOf(e.level) >= min &&
    (!q || e.message.toLowerCase().includes(q.toLowerCase()));
  const print = (e: LogEntry) =>
    cli.out(cli.bool("json") ? JSON.stringify(e) : logLine(cli, e));

  const tail = Math.min(2000, Math.max(0, cli.int("tail", 100)));
  const params = new URLSearchParams({ limit: "2000" });
  if (level) params.set("level", level);
  if (q) params.set("q", q);
  const { entries } = await client.get<{ entries: LogEntry[] }>(
    `/api/logs?${params}`,
  );
  // The server filters by exact level; "and above" is applied here.
  for (const e of tail ? entries.filter(matches).slice(-tail) : []) print(e);
  if (!cli.bool("follow")) return EXIT.ok;

  let last = entries.at(-1)?.seq ?? 0;
  // Reconnect when the stream drops (server restart), until interrupted.
  while (!cli.deps.signal.aborted) {
    try {
      const res = await client.events(`/api/logs/stream?after=${last}`);
      await readEvents(res, (event, data) => {
        if (event !== "log") return;
        const e = JSON.parse(data) as LogEntry;
        if (e.seq <= last) return;
        last = e.seq;
        if (matches(e)) print(e);
      });
    } catch (err) {
      if (cli.deps.signal.aborted || (err as Error).name === "AbortError")
        break;
      throw err;
    }
    if (cli.deps.signal.aborted) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return EXIT.ok;
}

// ---------------------------------------------------------------- audit

export async function audit(cli: Cli, sub: string): Promise<number> {
  const client = cli.client();
  const s = cli.style;
  if (sub === "verify") {
    const v = await client.json<{
      ok: boolean;
      count: number;
      brokenAt: number | null;
      head: string;
    }>("POST", "/api/audit/verify", {});
    if (cli.bool("json")) cli.out(JSON.stringify(v, null, 2));
    else if (v.ok)
      cli.out(
        `${s.green("✓")} audit chain intact: ${v.count} entries, head ${v.head}`,
      );
    else
      cli.out(
        `${s.red("✗")} audit chain broken${typeof v.brokenAt === "number" ? ` at entry ${v.brokenAt}` : ""} (${v.count} entries checked)`,
      );
    return v.ok ? EXIT.ok : EXIT.failure;
  }
  const params = new URLSearchParams({
    limit: String(Math.min(500, Math.max(1, cli.int("limit", 50)))),
  });
  if (cli.str("action")) params.set("action", cli.str("action")!);
  if (cli.flags.before !== undefined)
    params.set("before", String(cli.int("before", 0)));
  const { entries } = await client.get<{ entries: AuditEntry[] }>(
    `/api/audit?${params}`,
  );
  if (cli.bool("json"))
    return (cli.out(JSON.stringify(entries, null, 2)), EXIT.ok);
  const format = cli.str("format");
  if (format !== undefined) {
    for (const e of entries)
      cli.out(
        format === "json" ? JSON.stringify(e) : renderTemplate(format, e),
      );
    return EXIT.ok;
  }
  if (!entries.length) return EXIT.ok;
  cli.out(
    table(
      entries,
      [
        { header: "id", value: (e) => String(e.id) },
        { header: "time", value: (e) => when(e.at, cli.tty, cli.now()) },
        { header: "action", value: (e) => e.action },
        { header: "actor", value: (e) => e.actor ?? "" },
        { header: "target", value: (e) => e.target ?? "" },
        { header: "ip", value: (e) => e.ip ?? "" },
        {
          header: "detail",
          value: (e) => (e.detail ? JSON.stringify(e.detail) : ""),
        },
      ],
      cli.tty,
    ),
  );
  return EXIT.ok;
}

// ---------------------------------------------------------------- doctor & system

export async function doctor(cli: Cli): Promise<number> {
  const r = await cli
    .client()
    .get<{ at: number; results: CheckResult[] }>("/api/checks");
  const failed = r.results.some((c) => c.status === "fail");
  if (cli.bool("json")) {
    cli.out(JSON.stringify(r, null, 2));
    return failed ? EXIT.failure : EXIT.ok;
  }
  const s = cli.style;
  const width = Math.max(...r.results.map((c) => c.label.length));
  for (const c of r.results) {
    cli.out(
      `${checkMark(s, c.status)} ${c.label.padEnd(width)}  ${c.status === "ok" || c.status === "skip" ? s.dim(c.detail) : c.detail}`,
    );
    if (c.hint && c.status !== "ok")
      cli.out(`  ${" ".repeat(width)}  ${s.cyan(`→ ${c.hint}`)}`);
  }
  const counts = (st: CheckResult["status"]) =>
    r.results.filter((c) => c.status === st).length;
  cli.err(
    s.dim(
      `\n${counts("ok")} ok, ${counts("warn")} warnings, ${counts("fail")} failed, ${counts("skip")} skipped`,
    ),
  );
  return failed ? EXIT.failure : EXIT.ok;
}

function flatten(value: unknown, prefix = ""): [string, string][] {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return [
      [prefix, Array.isArray(value) ? value.join(", ") || "[]" : String(value)],
    ];
  return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) =>
    flatten(v, prefix ? `${prefix}.${k}` : k),
  );
}

export async function system(cli: Cli, sub: string): Promise<number> {
  const client = cli.client();
  const s = cli.style;
  const json = (v: unknown) => cli.out(JSON.stringify(v, null, 2));
  switch (sub) {
    case "config": {
      const config = await client.get<Record<string, unknown>>("/api/config");
      if (cli.bool("json")) json(config);
      else cli.out(pairs(flatten(config), s));
      return EXIT.ok;
    }
    case "housekeeping": {
      const report = await client.json<Record<string, number>>(
        "POST",
        "/api/actions/housekeeping",
        {},
      );
      if (cli.bool("json")) json(report);
      else
        cli.ok(
          `Housekeeping done: ${Object.entries(report)
            .map(([k, v]) => `${k} ${v}`)
            .join(", ")}`,
        );
      return EXIT.ok;
    }
    case "backup": {
      const r = await client.json<{ path: string }>(
        "POST",
        "/api/actions/backup",
        {},
      );
      if (cli.bool("json")) json(r);
      else cli.ok(`Backup written on the server to ${r.path}`);
      return EXIT.ok;
    }
    case "renew-cert": {
      const tls = await client.json<Overview["tls"]>(
        "POST",
        "/api/actions/renew-certificate",
        {},
      );
      if (cli.bool("json")) json(tls);
      else
        cli.ok(
          `Certificate renewed: ${[tls.names, tls.notAfter ? `valid until ${tls.notAfter}` : null].filter(Boolean).join(" · ")}`,
        );
      return EXIT.ok;
    }
    case "refresh-ports": {
      const p = await client.json<PortMapStatus>(
        "POST",
        "/api/actions/refresh-port-mapping",
        {},
      );
      if (cli.bool("json")) json(p);
      else if (p.error) cli.err(s.red(`Port mapping failed: ${p.error}`));
      else cli.ok(`Port mapping refreshed: ${portMapping(p)}`);
      return p.error ? EXIT.failure : EXIT.ok;
    }
    case "diagnostics": {
      const res = await client.call("GET", "/api/diagnostics");
      const disposition = String(res.headers["content-disposition"] ?? "");
      const suggested =
        /filename="([^"]+)"/.exec(disposition)?.[1] ??
        "storage-diagnostics.json";
      const path = cli.save(cli.str("output") ?? suggested, res.body);
      if (path)
        cli.ok(
          `Saved the diagnostics bundle to ${path} — no tokens, codes or user content`,
        );
      return EXIT.ok;
    }
  }
  throw new Error(`unhandled system subcommand ${sub}`);
}

// ---------------------------------------------------------------- api

function typed(value: string): unknown {
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null") return null;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  return value;
}

export async function api(cli: Cli): Promise<number> {
  const fields: Record<string, unknown> = {};
  const add = (spec: string, convert: (v: string) => unknown) => {
    const eq = spec.indexOf("=");
    if (eq <= 0) throw new UsageError(`a field is key=value: ${spec}`);
    fields[spec.slice(0, eq)] = convert(spec.slice(eq + 1));
  };
  for (const f of cli.list("field")) add(f, (v) => v);
  for (const f of cli.list("typed-field")) add(f, typed);
  let body: unknown;
  const input = cli.str("input");
  if (input !== undefined) {
    if (Object.keys(fields).length)
      throw new UsageError("--input and fields exclude each other");
    const text =
      input === "-"
        ? await cli.deps.readStdin()
        : readFileSync(resolve(cli.deps.cwd, input), "utf8");
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      throw new UsageError("--input must hold JSON");
    }
  } else if (Object.keys(fields).length) {
    body = fields;
  }
  const method = (
    cli.str("method") ?? (body === undefined ? "GET" : "POST")
  ).toUpperCase();
  const res = await cli.client().request(method, cli.arg(0), body);
  const type = String(res.headers["content-type"] ?? "");
  if (type.includes("json")) {
    const data = parseJson(res.body);
    cli.out(cli.tty ? JSON.stringify(data, null, 2) : JSON.stringify(data));
  } else if (res.body.length) {
    if (cli.deps.write) cli.deps.write(res.body);
    else cli.out(res.body.toString("utf8"));
  }
  if (res.status >= 400) {
    cli.err(cli.style.red(`HTTP ${res.status}`));
    return res.status === 401 ? EXIT.auth : EXIT.failure;
  }
  return EXIT.ok;
}
