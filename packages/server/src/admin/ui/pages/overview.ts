import { get } from "../api.ts";
import { line, stackedBars } from "../charts.ts";
import {
  ago,
  badge,
  bytes,
  card,
  clock,
  duration,
  h,
  kv,
  num,
  stat,
  table,
  toneOf,
  when,
} from "../dom.ts";
import { type Page, pageHeader, refresh } from "../page.ts";
import type { Overview } from "../types.ts";

const HEALTH_TEXT = {
  ok: "All checks pass",
  warn: "Needs attention",
  fail: "Problem",
} as const;

function healthCard(o: Overview) {
  const { status, problems, checkedAt } = o.health;
  return h(
    "section",
    { class: `health ${status}`, "data-testid": "health" },
    h(
      "div",
      { class: "health-head" },
      h("span", { class: `dot ${status}`, "aria-hidden": "true" }),
      h("strong", null, HEALTH_TEXT[status]),
      h("span", { class: "muted" }, ` · checked ${ago(checkedAt)}`),
      h("a", { href: "#/troubleshoot", class: "push" }, "Troubleshoot →"),
    ),
    problems.length
      ? h(
          "ul",
          { class: "problems" },
          problems.map((p) =>
            h(
              "li",
              null,
              badge(p.status, toneOf(p.status)),
              " ",
              h("strong", null, p.label),
              h("span", { class: "muted" }, ` — ${p.detail}`),
              p.hint ? h("div", { class: "hint" }, p.hint) : null,
            ),
          ),
        )
      : null,
  );
}

function trafficChart(o: Overview) {
  const series = o.traffic.series;
  const times = series.map((b) => b.at);
  return h(
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
            values: series.map(
              (b) => b.requests - b.clientErrors - b.serverErrors,
            ),
          },
          {
            label: "4xx",
            class: "bar-warn",
            values: series.map((b) => b.clientErrors),
          },
          {
            label: "5xx",
            class: "bar-fail",
            values: series.map((b) => b.serverErrors),
          },
        ],
        { label: "Requests per minute, last hour" },
      ),
      h(
        "p",
        { class: "legend" },
        h("span", { class: "key bar-ok" }),
        "ok ",
        h("span", { class: "key bar-warn" }),
        "4xx ",
        h("span", { class: "key bar-fail" }),
        "5xx",
      ),
    ),
    card(
      "Latency p95 per minute",
      line(
        times,
        series.map((b) => b.p95),
        { unit: " ms", label: "p95 latency per minute, last hour" },
      ),
      h(
        "p",
        { class: "legend" },
        `p50 ${o.traffic.latency.p50} ms · p95 ${o.traffic.latency.p95} ms · p99 ${o.traffic.latency.p99} ms`,
      ),
    ),
  );
}

function render(o: Overview) {
  const lastHour = o.traffic.series.reduce(
    (acc, b) => ({
      requests: acc.requests + b.requests,
      errors: acc.errors + b.serverErrors,
      client: acc.client + b.clientErrors,
    }),
    { requests: 0, errors: 0, client: 0 },
  );
  const thisMinute = o.traffic.series.at(-1)?.requests ?? 0;
  const s = o.storage;
  const tls = o.tls;
  const pm = o.portMapping;
  return [
    healthCard(o),
    h(
      "div",
      { class: "stats" },
      stat(
        "Uptime",
        duration(o.server.uptimeSeconds),
        `since ${when(o.server.startedAt)}`,
      ),
      stat(
        "Requests (1 h)",
        num(lastHour.requests),
        `${thisMinute} this minute`,
        undefined,
        "stat-requests",
      ),
      stat(
        "Server errors (1 h)",
        num(lastHour.errors),
        `${num(lastHour.client)} client errors`,
        lastHour.errors > 0 ? "fail" : undefined,
      ),
      stat(
        "Latency p95",
        `${o.traffic.latency.p95} ms`,
        `p50 ${o.traffic.latency.p50} ms`,
      ),
      stat(
        "Live connections",
        num(o.traffic.sseConnections),
        "devices listening for changes",
      ),
      stat(
        "Accounts",
        num(o.counts.accounts),
        `${o.counts.admins} admin · ${o.counts.disabledAccounts} disabled`,
        undefined,
        "stat-accounts",
      ),
      stat(
        "Devices",
        num(o.counts.devices),
        `${o.counts.pendingDevices} pending · ${o.counts.revokedDevices} revoked`,
        o.counts.pendingDevices > 0 ? "warn" : undefined,
      ),
      stat(
        "Namespaces",
        num(o.counts.namespaces),
        `${num(o.counts.files)} files · ${num(o.counts.records)} records`,
      ),
      stat(
        "Stored",
        bytes(s.blobBytes + s.databaseBytes),
        s.diskFreeBytes === null
          ? "in memory"
          : `${bytes(s.diskFreeBytes)} disk free`,
        s.diskFreeBytes !== null && s.diskFreeBytes < 2 * 1024 ** 3
          ? "warn"
          : undefined,
      ),
    ),
    trafficChart(o),
    h(
      "div",
      { class: "grid-3" },
      card(
        "Server",
        kv([
          ["Version", o.server.version],
          ["Server id", h("code", null, o.server.serverId)],
          ["Runtime", `Node ${o.server.node} · ${o.server.platform}`],
          [
            "Process",
            `pid ${o.server.pid} · ${bytes(o.server.memory.rss)} memory`,
          ],
          ["Load", o.server.load.map((l) => l.toFixed(2)).join(" · ")],
          ["Data", s.dataDir ? h("code", null, s.dataDir) : "in memory"],
          ["Database", `${bytes(s.databaseBytes)}`],
          ["Blobs", `${num(s.blobCount)} · ${bytes(s.blobBytes)}`],
          [
            "Audit log",
            [
              badge(
                o.audit.ok ? "intact" : "broken",
                o.audit.ok ? "ok" : "fail",
              ),
              ` ${num(o.audit.entries)} entries`,
            ],
          ],
        ]),
      ),
      card(
        "Network",
        kv([
          [
            "Public URL",
            [
              h("code", null, o.urls.public),
              o.urls.publicConfigured
                ? null
                : h(
                    "div",
                    { class: "hint" },
                    "Not configured (--public-url): QR codes use this guess.",
                  ),
            ],
          ],
          ["TLS", badge(tls.mode, tls.mode === "off" ? "muted" : "info")],
          [
            "Certificate",
            tls.notAfter
              ? [
                  `expires ${when(tls.notAfter)} `,
                  badge(
                    `${tls.daysLeft} days`,
                    (tls.daysLeft ?? 0) < 0
                      ? "fail"
                      : (tls.daysLeft ?? 0) < 7
                        ? "warn"
                        : "ok",
                  ),
                ]
              : "—",
          ],
          ["Names", tls.names ?? "—"],
          ["Fingerprint", tls.fp ? h("code", { class: "wrap" }, tls.fp) : "—"],
          [
            "Port mapping",
            pm === null
              ? "off"
              : pm.method
                ? [
                    badge(pm.method, pm.warning ? "warn" : "ok"),
                    ` ${pm.externalIp ?? "?"} · ${pm.mapped.map((p) => `${p.external}→${p.internal}`).join(", ")}`,
                    pm.warning ? h("div", { class: "hint" }, pm.warning) : null,
                  ]
                : [badge("failed", "fail"), ` ${pm.error ?? ""}`],
          ],
        ]),
      ),
      card(
        "Recent warnings and errors",
        table(
          [
            { label: "Time", cell: (e) => clock(e.at), class: "nowrap" },
            {
              label: "Level",
              cell: (e) =>
                badge(e.level, toneOf(e.level === "warn" ? "warn" : "fail")),
            },
            { label: "Message", cell: (e) => e.message },
          ],
          o.recent.problems,
          { empty: "None since the server started." },
        ),
        h("a", { href: "#/logs" }, "All logs →"),
      ),
    ),
    card(
      "Recent administration",
      table(
        [
          { label: "Time", cell: (e) => when(e.at), class: "nowrap" },
          { label: "Action", cell: (e) => h("code", null, e.action) },
          { label: "By", cell: (e) => e.actor ?? "—" },
          {
            label: "Target",
            cell: (e) => (e.target ? h("code", null, e.target) : "—"),
          },
        ],
        o.recent.audit,
        { empty: "No audit entries yet." },
      ),
      h("a", { href: "#/audit" }, "Full audit log →"),
    ),
  ];
}

export const overviewPage: Page = {
  id: "overview",
  label: "Overview",
  render(ctx) {
    const body = h(
      "div",
      { class: "stack" },
      h("p", { class: "muted" }, "Loading…"),
    );
    ctx.root.append(pageHeader("Overview"), body);
    ctx.every(5000, () =>
      refresh(body, async () => render(await get<Overview>("/api/overview"))),
    );
  },
};
