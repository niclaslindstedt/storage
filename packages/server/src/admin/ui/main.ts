// The admin console single-page app (SPEC §11.1): a sidebar, a hash router
// and one module per page. Served as /app.js by the console; talks only to
// the console's own /api (same origin, session cookie, CSRF header).

import "./styles.css";

import { get } from "./api.ts";
import { clear, h } from "./dom.ts";
import type { Page, PageContext } from "./page.ts";
import { accountsPage } from "./pages/accounts.ts";
import { auditPage } from "./pages/audit.ts";
import { devicesPage } from "./pages/devices.ts";
import { logsPage } from "./pages/logs.ts";
import { namespacesPage } from "./pages/namespaces.ts";
import { overviewPage } from "./pages/overview.ts";
import { trafficPage } from "./pages/traffic.ts";
import { troubleshootPage } from "./pages/troubleshoot.ts";
import type { Overview } from "./types.ts";

const PAGES: Page[] = [
  overviewPage,
  accountsPage,
  devicesPage,
  namespacesPage,
  trafficPage,
  logsPage,
  auditPage,
  troubleshootPage,
];

const app = document.getElementById("app")!;
const serverName = app.dataset.name ?? "storage";

const healthDot = h("span", { class: "dot", "aria-hidden": "true" });
const healthText = h("span", { class: "health-text" }, "…");
const version = h("span", { class: "version" });
const nav = h(
  "nav",
  { class: "sidebar", "aria-label": "Sections" },
  h(
    "ul",
    null,
    PAGES.map((p) =>
      h("li", null, h("a", { href: `#/${p.id}`, "data-page": p.id }, p.label)),
    ),
  ),
);
const main = h("main", { id: "main", tabindex: "-1" });

clear(
  app,
  h(
    "header",
    { class: "topbar" },
    h(
      "a",
      { class: "brand", href: "#/overview" },
      h("span", { class: "logo", "aria-hidden": "true" }),
      h("span", null, serverName),
      version,
    ),
    h(
      "a",
      {
        class: "health-pill",
        href: "#/troubleshoot",
        "data-testid": "health-pill",
      },
      healthDot,
      healthText,
    ),
    h(
      "form",
      { method: "post", action: "/logout", class: "logout" },
      h("button", { type: "submit", "data-testid": "sign-out" }, "Sign out"),
    ),
  ),
  h("div", { class: "layout" }, nav, main),
);

// Header: version and a health indicator, refreshed in the background.
async function header() {
  try {
    const o = await get<Overview>("/api/overview");
    version.textContent = `v${o.server.version}`;
    healthDot.className = `dot ${o.health.status}`;
    healthText.textContent =
      o.health.status === "ok"
        ? "Healthy"
        : `${o.health.problems.length} issue${o.health.problems.length === 1 ? "" : "s"}`;
    document.title = `${o.health.status === "ok" ? "" : "⚠ "}${serverName} — storage admin`;
  } catch {
    healthDot.className = "dot fail";
    healthText.textContent = "Unreachable";
  }
}
void header();
setInterval(() => void header(), 30_000);

// Router.
let leave: (() => void)[] = [];
let generation = 0;

async function route() {
  for (const fn of leave.splice(0)) fn();
  const id = location.hash.replace(/^#\/?/, "").split("?")[0] || "overview";
  const page = PAGES.find((p) => p.id === id) ?? overviewPage;
  const mine = ++generation;
  for (const a of nav.querySelectorAll("a"))
    if (a.dataset.page === page.id) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  clear(main);
  const ctx: PageContext = {
    root: main,
    every(ms, fn) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const tick = async () => {
        if (mine !== generation) return;
        try {
          await fn();
        } finally {
          if (mine === generation) timer = setTimeout(() => void tick(), ms);
        }
      };
      void tick();
      leave.push(() => clearTimeout(timer));
    },
    onLeave(fn) {
      leave.push(fn);
    },
  };
  try {
    await page.render(ctx);
  } catch (err) {
    main.append(
      h(
        "p",
        { class: "alert", role: "alert" },
        `This page failed to load: ${(err as Error).message}`,
      ),
    );
  }
  if (mine === generation) main.focus({ preventScroll: true });
}

window.addEventListener("hashchange", () => {
  void route();
  void header();
});
void route();
