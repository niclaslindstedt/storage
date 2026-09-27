import { describe, expect, it } from "vitest";

import { Metrics } from "../src/admin/metrics.ts";
import { ManualClock } from "../src/util/clock.ts";

const T0 = 1_800_000_000_000 - (1_800_000_000_000 % 60_000);

function metrics() {
  const clock = new ManualClock(T0);
  return { clock, m: new Metrics(clock) };
}

describe("Metrics", () => {
  it("counts requests per minute by outcome, oldest first, 60 buckets", () => {
    const { clock, m } = metrics();
    m.record({ method: "GET", route: "/v1/info", status: 200, ms: 3 });
    m.record({ method: "GET", route: "/v1/info", status: 404, ms: 1 });
    m.record({
      method: "PUT",
      route: "/v1/ns/:ns/records/:c/:k",
      status: 500,
      ms: 40,
    });
    m.record({ method: "GET", route: "/v1/info", status: 429, ms: 1 });
    clock.advance(60_000);
    m.record({ method: "GET", route: "/v1/info", status: 200, ms: 5 });

    const series = m.series();
    expect(series).toHaveLength(60);
    const [prev, last] = series.slice(-2);
    expect(prev).toMatchObject({
      at: T0,
      requests: 4,
      clientErrors: 2,
      serverErrors: 1,
      rateLimited: 1,
    });
    expect(last).toMatchObject({ at: T0 + 60_000, requests: 1 });
    expect(series[0]!.requests).toBe(0);
  });

  it("forgets minutes older than the window", () => {
    const { clock, m } = metrics();
    m.record({ method: "GET", route: "/a", status: 200, ms: 1 });
    clock.advance(61 * 60_000);
    expect(m.series().every((b) => b.requests === 0)).toBe(true);
    expect(m.totals().requests).toBe(1); // totals are since start
  });

  it("reports latency percentiles per minute and overall", () => {
    const { m } = metrics();
    for (let ms = 1; ms <= 100; ms++)
      m.record({ method: "GET", route: "/a", status: 200, ms });
    const last = m.series().at(-1)!;
    expect(last.p50).toBe(50);
    expect(last.p95).toBe(95);
    expect(m.latency()).toEqual({ p50: 50, p95: 95, p99: 99 });
  });

  it("aggregates per route, busiest first", () => {
    const { m } = metrics();
    m.record({ method: "GET", route: "/a", status: 200, ms: 10 });
    m.record({ method: "GET", route: "/a", status: 503, ms: 30 });
    m.record({ method: "POST", route: "/b", status: 400, ms: 2 });
    expect(m.routes()).toEqual([
      {
        method: "GET",
        route: "/a",
        count: 2,
        clientErrors: 0,
        serverErrors: 1,
        avgMs: 20,
        maxMs: 30,
      },
      {
        method: "POST",
        route: "/b",
        count: 1,
        clientErrors: 1,
        serverErrors: 0,
        avgMs: 2,
        maxMs: 2,
      },
    ]);
  });

  it("renders Prometheus text with counters, a histogram and extra gauges", () => {
    const { m } = metrics();
    m.record({ method: "GET", route: "/v1/info", status: 200, ms: 3 });
    m.record({ method: "GET", route: "/v1/info", status: 200, ms: 700 });
    const text = m.prometheus({ storage_accounts: 2, storage_up_seconds: 5 });
    expect(text).toContain("# TYPE storage_http_requests_total counter");
    expect(text).toContain(
      'storage_http_requests_total{method="GET",route="/v1/info",status="200"} 2',
    );
    expect(text).toContain(
      "# TYPE storage_http_request_duration_seconds histogram",
    );
    expect(text).toContain(
      'storage_http_request_duration_seconds_bucket{route="/v1/info",le="0.005"} 1',
    );
    expect(text).toContain(
      'storage_http_request_duration_seconds_bucket{route="/v1/info",le="+Inf"} 2',
    );
    expect(text).toContain(
      'storage_http_request_duration_seconds_count{route="/v1/info"} 2',
    );
    expect(text).toContain("# TYPE storage_accounts gauge\nstorage_accounts 2");
    expect(text.endsWith("\n")).toBe(true);
  });

  it("counts streaming requests without letting them skew latency", () => {
    const { m } = metrics();
    m.record({ method: "GET", route: "/a", status: 200, ms: 10 });
    m.record({
      method: "GET",
      route: "/a",
      status: 200,
      ms: 30_000,
      streaming: true,
    });
    expect(m.series().at(-1)!.requests).toBe(2);
    expect(m.latency().p99).toBe(10);
    expect(m.routes()[0]).toMatchObject({ count: 2, avgMs: 10, maxMs: 10 });
    expect(m.prometheus({})).toContain(
      'storage_http_request_duration_seconds_count{route="/a"} 1',
    );
  });

  it("tracks open SSE connections", () => {
    const { m } = metrics();
    m.sseOpened();
    m.sseOpened();
    m.sseClosed();
    expect(m.sseConnections).toBe(1);
    expect(m.prometheus({})).toContain("storage_sse_connections 1");
  });

  it("escapes label values", () => {
    const { m } = metrics();
    m.record({ method: "GET", route: 'a"b\\c', status: 200, ms: 1 });
    expect(m.prometheus({})).toContain('route="a\\"b\\\\c"');
  });
});
