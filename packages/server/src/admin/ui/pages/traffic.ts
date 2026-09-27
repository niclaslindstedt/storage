import { get } from "../api.ts";
import { line, stackedBars } from "../charts.ts";
import { card, h, num, stat, table, when } from "../dom.ts";
import { type Page, pageHeader, refresh } from "../page.ts";
import type { Metrics } from "../types.ts";

function view(m: Metrics) {
  const times = m.series.map((b) => b.at);
  const t = m.totals;
  return [
    h(
      "div",
      { class: "stats" },
      stat(
        "Requests",
        num(t.requests),
        `since ${when(t.since)}`,
        undefined,
        "traffic-requests",
      ),
      stat(
        "Client errors (4xx)",
        num(t.clientErrors),
        "bad input, auth, conflicts",
      ),
      stat(
        "Server errors (5xx)",
        num(t.serverErrors),
        "see Logs",
        t.serverErrors ? "fail" : undefined,
      ),
      stat(
        "Rate limited",
        num(t.rateLimited),
        "429 responses",
        t.rateLimited ? "warn" : undefined,
      ),
      stat(
        "Latency",
        `${m.latency.p95} ms`,
        `p50 ${m.latency.p50} · p99 ${m.latency.p99} ms`,
      ),
      stat("Live connections", num(m.sseConnections), "open event streams"),
    ),
    h(
      "div",
      { class: "grid-2" },
      card(
        "Requests per minute",
        stackedBars(
          times,
          [
            {
              label: "ok",
              class: "bar-ok",
              values: m.series.map(
                (b) => b.requests - b.clientErrors - b.serverErrors,
              ),
            },
            {
              label: "4xx",
              class: "bar-warn",
              values: m.series.map((b) => b.clientErrors - b.rateLimited),
            },
            {
              label: "429",
              class: "bar-limit",
              values: m.series.map((b) => b.rateLimited),
            },
            {
              label: "5xx",
              class: "bar-fail",
              values: m.series.map((b) => b.serverErrors),
            },
          ],
          { label: "Requests per minute by outcome, last hour" },
        ),
        h(
          "p",
          { class: "legend" },
          h("span", { class: "key bar-ok" }),
          "ok ",
          h("span", { class: "key bar-warn" }),
          "4xx ",
          h("span", { class: "key bar-limit" }),
          "429 ",
          h("span", { class: "key bar-fail" }),
          "5xx",
        ),
      ),
      card(
        "Latency per minute",
        line(
          times,
          m.series.map((b) => b.p95),
          { unit: " ms", label: "p95 latency", class: "line" },
        ),
        h(
          "p",
          { class: "legend" },
          "p95; long-polls and live streams are excluded",
        ),
      ),
    ),
    card(
      "By endpoint",
      table(
        [
          { label: "Method", cell: (r) => h("code", null, r.method) },
          { label: "Route", cell: (r) => h("code", null, r.route) },
          { label: "Requests", cell: (r) => num(r.count), class: "num" },
          { label: "4xx", cell: (r) => num(r.clientErrors), class: "num" },
          { label: "5xx", cell: (r) => num(r.serverErrors), class: "num" },
          { label: "Avg", cell: (r) => `${r.avgMs} ms`, class: "num" },
          { label: "Max", cell: (r) => `${r.maxMs} ms`, class: "num" },
        ],
        m.routes,
        { testid: "routes-table", empty: "No requests yet." },
      ),
      h(
        "p",
        { class: "muted" },
        "Routes are patterns (",
        h("code", null, ":ns"),
        " stands for a namespace id); no path, id or payload is recorded. Prometheus: ",
        h("code", null, "GET /metrics"),
        " with ",
        h("code", null, "Authorization: Bearer <admin token>"),
        ".",
      ),
    ),
  ];
}

export const trafficPage: Page = {
  id: "traffic",
  label: "Traffic",
  render(ctx) {
    const body = h(
      "div",
      { class: "stack" },
      h("p", { class: "muted" }, "Loading…"),
    );
    ctx.root.append(pageHeader("Traffic"), body);
    ctx.every(5000, () =>
      refresh(body, async () => view(await get<Metrics>("/api/metrics"))),
    );
  },
};
