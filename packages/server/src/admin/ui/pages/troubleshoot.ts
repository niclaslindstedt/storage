import { download, get, post } from "../api.ts";
import { ago, badge, card, clear, h, toast, toneOf } from "../dom.ts";
import { type Page, pageHeader } from "../page.ts";
import type { CheckResult } from "../types.ts";

type Config = {
  tls: { mode: string };
  upnp: { enabled: boolean };
  dataDir: string | null;
};

const ICON = { ok: "✓", warn: "!", fail: "✕", skip: "–" } as const;

export const troubleshootPage: Page = {
  id: "troubleshoot",
  label: "Troubleshoot",
  async render(ctx) {
    const list = h(
      "ul",
      { class: "checks", "data-testid": "checks" },
      h("li", { class: "muted" }, "Running checks…"),
    );
    const when = h("span", { class: "muted" });
    const run = h(
      "button",
      {
        type: "button",
        class: "primary",
        "data-testid": "run-checks",
        onclick: () => void checks(),
      },
      "Run checks again",
    );

    async function checks() {
      run.disabled = true;
      try {
        const r = await get<{ at: number; results: CheckResult[] }>(
          "/api/checks",
        );
        when.textContent = `checked ${ago(r.at)}`;
        clear(
          list,
          r.results.map((c) =>
            h(
              "li",
              { class: `check ${c.status}`, "data-testid": `check-${c.id}` },
              h(
                "span",
                { class: `icon ${c.status}`, "aria-hidden": "true" },
                ICON[c.status],
              ),
              h(
                "div",
                null,
                h(
                  "div",
                  null,
                  h("strong", null, c.label),
                  " ",
                  badge(c.status, toneOf(c.status)),
                ),
                h("div", { class: "muted" }, c.detail),
                c.hint && c.status !== "ok"
                  ? h("div", { class: "hint" }, c.hint)
                  : null,
              ),
            ),
          ),
        );
      } finally {
        run.disabled = false;
      }
    }

    const config = await get<Config & Record<string, unknown>>("/api/config");

    function action(
      label: string,
      description: string,
      fn: () => Promise<void>,
      opts: { enabled?: boolean; why?: string; testid?: string } = {},
    ) {
      const button = h(
        "button",
        {
          type: "button",
          disabled: opts.enabled === false,
          "data-testid": opts.testid,
        },
        label,
      );
      button.addEventListener("click", async () => {
        button.disabled = true;
        try {
          await fn();
        } catch (err) {
          toast((err as Error).message, "fail");
        } finally {
          button.disabled = opts.enabled === false;
        }
      });
      return h(
        "div",
        { class: "action" },
        button,
        h(
          "div",
          null,
          description,
          opts.enabled === false && opts.why
            ? h("div", { class: "hint" }, opts.why)
            : null,
        ),
      );
    }

    ctx.root.append(
      pageHeader("Troubleshoot", run),
      card(h("span", null, "Checks ", when), list),
      card(
        "Actions",
        h(
          "div",
          { class: "actions-list" },
          action(
            "Renew certificate",
            "Ask the ACME CA for a new certificate now.",
            async () => {
              await post("/api/actions/renew-certificate");
              toast("Certificate renewed", "ok");
              await checks();
            },
            {
              enabled: config.tls.mode === "acme",
              why: `TLS mode is ${config.tls.mode}; renewal applies to acme only.`,
            },
          ),
          action(
            "Refresh port mapping",
            "Ask the router (UPnP / NAT-PMP) to forward the ports again.",
            async () => {
              const s = await post<{
                method: string | null;
                error: string | null;
              }>("/api/actions/refresh-port-mapping");
              toast(
                s.method
                  ? `Mapped via ${s.method}`
                  : `Failed: ${s.error ?? "unknown"}`,
                s.method ? "ok" : "fail",
              );
              await checks();
            },
            {
              enabled: config.upnp.enabled,
              why: "Port mapping is off (--upnp).",
            },
          ),
          action(
            "Run housekeeping",
            "Purge expired trash, tombstones and abandoned uploads now (it also runs hourly).",
            async () => {
              const r = await post<Record<string, number>>(
                "/api/actions/housekeeping",
              );
              toast(
                `Done: ${Object.entries(r)
                  .map(([k, v]) => `${v} ${k}`)
                  .join(", ")}`,
                "ok",
              );
            },
            { testid: "housekeeping" },
          ),
          action(
            "Back up now",
            "Write a consistent copy of the database, blobs and certificates to backups/ in the data directory.",
            async () => {
              const r = await post<{ path: string }>("/api/actions/backup");
              toast(`Backup written to ${r.path}`, "ok");
            },
            {
              enabled: config.dataDir !== null,
              why: "This server keeps everything in memory.",
            },
          ),
          action(
            "Download diagnostics",
            "Overview, checks, configuration, traffic and the last 500 log lines as JSON — for a bug report. It holds no tokens, pairing codes, keys or stored content.",
            async () => download("/api/diagnostics"),
            { testid: "diagnostics" },
          ),
        ),
      ),
      card(
        "Configuration",
        h(
          "p",
          { class: "muted" },
          "The effective settings (flags > environment > config.json > defaults). Change them where you start the server.",
        ),
        h(
          "details",
          null,
          h("summary", null, "Show configuration"),
          h(
            "pre",
            { class: "code", "data-testid": "config" },
            JSON.stringify(config, null, 2),
          ),
        ),
      ),
      card(
        "Console access",
        h(
          "p",
          null,
          "The console is unlocked by the token in ",
          h("code", null, `${config.dataDir ?? "(memory)"}/admin.token`),
          ". Shared a sign-in link by mistake? Run ",
          h("code", null, "storage-server admin --rotate"),
          " — every console session ends immediately.",
        ),
      ),
    );
    await checks();
  },
};
