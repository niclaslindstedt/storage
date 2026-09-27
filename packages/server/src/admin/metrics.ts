// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Request metrics for the admin console (SPEC §11.1): per-minute buckets for
// the last hour, per-route aggregates since start, latency percentiles, and
// Prometheus text exposition. Fed by the device-API handler's `onRequest`
// hook; holds only method, route pattern, status and duration — never a
// path, an id or anything a device sent.

import type { Clock } from "../util/clock.ts";

export type RequestSample = {
  method: string;
  /** The route pattern (`/v1/ns/:ns/files/*path`), never the concrete path. */
  route: string;
  status: number;
  ms: number;
  /** Long-poll or SSE: counted, but kept out of latency statistics. */
  streaming?: boolean;
};

export type MinuteBucket = {
  /** Start of the minute (epoch ms). */
  at: number;
  requests: number;
  clientErrors: number;
  serverErrors: number;
  rateLimited: number;
  p50: number;
  p95: number;
};

export type RouteStats = {
  method: string;
  route: string;
  count: number;
  clientErrors: number;
  serverErrors: number;
  avgMs: number;
  maxMs: number;
};

type Bucket = Omit<MinuteBucket, "p50" | "p95"> & { durations: number[] };

type RouteAgg = {
  method: string;
  route: string;
  count: number;
  clientErrors: number;
  serverErrors: number;
  timed: number;
  totalMs: number;
  maxMs: number;
};

const MINUTE = 60_000;
/** Samples kept per minute for percentiles (reservoir beyond this). */
const RESERVOIR = 2000;
/** Histogram buckets in seconds (Prometheus `le`). */
const LE = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

/** Nearest-rank percentile of an ascending array. */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.max(0, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[idx]!;
}

const label = (v: string) =>
  v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");

export class Metrics {
  private readonly buckets = new Map<number, Bucket>();
  private readonly perRoute = new Map<string, RouteAgg>();
  private readonly counters = new Map<string, number>();
  private readonly histograms = new Map<
    string,
    { counts: number[]; sum: number; count: number }
  >();
  private readonly total = {
    requests: 0,
    clientErrors: 0,
    serverErrors: 0,
    rateLimited: 0,
  };
  readonly since: number;
  private sse = 0;

  constructor(
    private readonly clock: Clock,
    private readonly minutes = 60,
  ) {
    this.since = clock.now();
  }

  record(sample: RequestSample): void {
    const now = this.clock.now();
    const minute = now - (now % MINUTE);
    let b = this.buckets.get(minute);
    if (!b) {
      b = {
        at: minute,
        requests: 0,
        clientErrors: 0,
        serverErrors: 0,
        rateLimited: 0,
        durations: [],
      };
      this.buckets.set(minute, b);
      this.prune(minute);
    }
    const client = sample.status >= 400 && sample.status < 500;
    const server = sample.status >= 500;
    const limited = sample.status === 429;
    for (const t of [b, this.total]) {
      t.requests++;
      if (client) t.clientErrors++;
      if (server) t.serverErrors++;
      if (limited) t.rateLimited++;
    }
    const timed = !sample.streaming;
    if (timed) {
      if (b.durations.length < RESERVOIR) b.durations.push(sample.ms);
      else {
        const j = Math.floor(Math.random() * b.requests);
        if (j < RESERVOIR) b.durations[j] = sample.ms;
      }
    }

    const key = `${sample.method} ${sample.route}`;
    const agg = this.perRoute.get(key) ?? {
      method: sample.method,
      route: sample.route,
      count: 0,
      clientErrors: 0,
      serverErrors: 0,
      timed: 0,
      totalMs: 0,
      maxMs: 0,
    };
    agg.count++;
    if (client) agg.clientErrors++;
    if (server) agg.serverErrors++;
    if (timed) {
      agg.timed++;
      agg.totalMs += sample.ms;
      agg.maxMs = Math.max(agg.maxMs, sample.ms);
    }
    this.perRoute.set(key, agg);

    const ckey = `${sample.method}\u0000${sample.route}\u0000${sample.status}`;
    this.counters.set(ckey, (this.counters.get(ckey) ?? 0) + 1);
    if (!timed) return;
    const h = this.histograms.get(sample.route) ?? {
      counts: LE.map(() => 0),
      sum: 0,
      count: 0,
    };
    const seconds = sample.ms / 1000;
    LE.forEach((le, i) => {
      if (seconds <= le) h.counts[i]!++;
    });
    h.sum += seconds;
    h.count++;
    this.histograms.set(sample.route, h);
  }

  private prune(current: number): void {
    const oldest = current - (this.minutes - 1) * MINUTE;
    for (const at of this.buckets.keys())
      if (at < oldest) this.buckets.delete(at);
  }

  /** One bucket per minute for the window, oldest first, gaps as zeros. */
  series(): MinuteBucket[] {
    const now = this.clock.now();
    const current = now - (now % MINUTE);
    const out: MinuteBucket[] = [];
    for (let i = this.minutes - 1; i >= 0; i--) {
      const at = current - i * MINUTE;
      const b = this.buckets.get(at);
      const sorted = b ? [...b.durations].sort((x, y) => x - y) : [];
      out.push({
        at,
        requests: b?.requests ?? 0,
        clientErrors: b?.clientErrors ?? 0,
        serverErrors: b?.serverErrors ?? 0,
        rateLimited: b?.rateLimited ?? 0,
        p50: percentile(sorted, 50),
        p95: percentile(sorted, 95),
      });
    }
    return out;
  }

  sseOpened(): void {
    this.sse++;
  }

  sseClosed(): void {
    this.sse = Math.max(0, this.sse - 1);
  }

  get sseConnections(): number {
    return this.sse;
  }

  /** Latency percentiles (ms) over the window. */
  latency(): { p50: number; p95: number; p99: number } {
    const oldest = this.clock.now() - this.minutes * MINUTE;
    const all: number[] = [];
    for (const b of this.buckets.values())
      if (b.at >= oldest) all.push(...b.durations);
    all.sort((x, y) => x - y);
    return {
      p50: percentile(all, 50),
      p95: percentile(all, 95),
      p99: percentile(all, 99),
    };
  }

  /** Totals since the server started. */
  totals(): typeof this.total & { since: number } {
    return { ...this.total, since: this.since };
  }

  routes(): RouteStats[] {
    return [...this.perRoute.values()]
      .sort((a, b) => b.count - a.count || a.route.localeCompare(b.route))
      .map((r) => ({
        method: r.method,
        route: r.route,
        count: r.count,
        clientErrors: r.clientErrors,
        serverErrors: r.serverErrors,
        avgMs: r.timed ? Math.round((r.totalMs / r.timed) * 10) / 10 : 0,
        maxMs: r.maxMs,
      }));
  }

  /** Prometheus text exposition (version 0.0.4) plus caller-supplied gauges. */
  prometheus(gauges: Record<string, number>): string {
    const lines: string[] = [
      "# HELP storage_http_requests_total Device API requests by method, route and status.",
      "# TYPE storage_http_requests_total counter",
    ];
    for (const [key, n] of [...this.counters].sort()) {
      const [method, route, status] = key.split("\u0000");
      lines.push(
        `storage_http_requests_total{method="${label(method!)}",route="${label(route!)}",status="${status}"} ${n}`,
      );
    }
    lines.push(
      "# HELP storage_http_request_duration_seconds Device API request duration.",
      "# TYPE storage_http_request_duration_seconds histogram",
    );
    for (const [route, h] of [...this.histograms].sort()) {
      const r = label(route);
      LE.forEach((le, i) =>
        lines.push(
          `storage_http_request_duration_seconds_bucket{route="${r}",le="${le}"} ${h.counts[i]}`,
        ),
      );
      lines.push(
        `storage_http_request_duration_seconds_bucket{route="${r}",le="+Inf"} ${h.count}`,
        `storage_http_request_duration_seconds_sum{route="${r}"} ${h.sum}`,
        `storage_http_request_duration_seconds_count{route="${r}"} ${h.count}`,
      );
    }
    lines.push(
      "# HELP storage_sse_connections Open live-event (SSE) connections.",
      "# TYPE storage_sse_connections gauge",
      `storage_sse_connections ${this.sse}`,
    );
    for (const [name, value] of Object.entries(gauges))
      lines.push(`# TYPE ${name} gauge`, `${name} ${value}`);
    return lines.join("\n") + "\n";
  }
}
