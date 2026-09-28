// The console's frame (SPEC §11.1): a top bar with the health pill, a
// sidebar, a hash router and one module per page. Mounted by the console's
// own entry (main.ts) and, unchanged, by the remote app (SPEC §11.2), which
// shares the hash with tabs of its own — so a hash that names no console
// page leaves the console idle instead of redirecting.

import { get } from "./api.ts";
import { type Child, clear, h } from "./dom.ts";
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

export const PAGES: Page[] = [
  overviewPage,
  accountsPage,
  devicesPage,
  namespacesPage,
  trafficPage,
  logsPage,
  auditPage,
  troubleshootPage,
];

/** The console page a hash names (`#/devices?account=x` → "devices"), or null. */
export function pageOf(hash: string): string | null {
  const id = hash.replace(/^#\/?/, "").split("?")[0] ?? "";
  return PAGES.some((p) => p.id === id) ? id : null;
}

export type ConsoleMount = {
  /** Whether the current hash shows a console page. */
  active(): boolean;
};

export function mountConsole(opts: {
  root: HTMLElement;
  serverName: string;
  /** Extra controls at the right of the top bar (the console's Sign out). */
  actions?: Child;
  /** Show the overview for a hash naming no page (the console itself). */
  fallback: boolean;
  /** Called with the tab title the health pill implies. */
  onTitle?(title: string): void;
}): ConsoleMount {
  const { root, serverName } = opts;
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
        h(
          "li",
          null,
          h("a", { href: `#/${p.id}`, "data-page": p.id }, p.label),
        ),
      ),
    ),
  );
  const main = h("main", { id: "main", tabindex: "-1" });

  clear(
    root,
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
      opts.actions,
    ),
    h("div", { class: "layout" }, nav, main),
  );

  const current = () =>
    pageOf(location.hash) ?? (opts.fallback ? "overview" : null);

  // Header: version and a health indicator, refreshed in the background.
  async function header() {
    if (!current()) return;
    try {
      const o = await get<Overview>("/api/overview");
      version.textContent = `v${o.server.version}`;
      healthDot.className = `dot ${o.health.status}`;
      healthText.textContent =
        o.health.status === "ok"
          ? "Healthy"
          : `${o.health.problems.length} issue${o.health.problems.length === 1 ? "" : "s"}`;
      opts.onTitle?.(
        `${o.health.status === "ok" ? "" : "⚠ "}${serverName} — storage admin`,
      );
    } catch {
      healthDot.className = "dot fail";
      healthText.textContent = "Unreachable";
    }
  }
  setInterval(() => void header(), 30_000);

  // Router.
  let leave: (() => void)[] = [];
  let generation = 0;
  let shown: string | null = null;

  async function route() {
    const id = current();
    const params = location.hash.split("?")[1] ?? "";
    const key = id ? `${id}?${params}` : null;
    if (key === shown) return;
    shown = key;
    for (const fn of leave.splice(0)) fn();
    const mine = ++generation;
    clear(main);
    if (!id) return; // another tab of the remote app has the screen
    const page = PAGES.find((p) => p.id === id)!;
    for (const a of nav.querySelectorAll("a"))
      if (a.dataset.page === page.id) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
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
  void header();
  return { active: () => current() !== null };
}
