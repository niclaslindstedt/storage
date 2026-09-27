import { get, post } from "../api.ts";
import { badge, clear, h, table, when } from "../dom.ts";
import { type Page, pageHeader } from "../page.ts";
import type { AuditEntry } from "../types.ts";

export const auditPage: Page = {
  id: "audit",
  label: "Audit log",
  async render(ctx) {
    const filter = h("input", {
      type: "search",
      placeholder: "Action, e.g. device or account.delete",
      "aria-label": "Filter by action",
      "data-testid": "audit-filter",
    });
    const verdict = h("span", { "data-testid": "audit-verdict" });
    const verify = h(
      "button",
      {
        type: "button",
        "data-testid": "audit-verify",
        onclick: async () => {
          const v = await post<{
            ok: boolean;
            count: number;
            brokenAt: number | null;
          }>("/api/audit/verify");
          clear(
            verdict,
            v.ok
              ? badge(`chain intact · ${v.count} entries`, "ok")
              : badge(`BROKEN at entry ${v.brokenAt}`, "fail"),
          );
        },
      },
      "Verify chain",
    );
    const body = h("div");
    const more = h("button", { type: "button", hidden: true }, "Load older");
    let rows: AuditEntry[] = [];

    const q = () =>
      filter.value.trim()
        ? `&action=${encodeURIComponent(filter.value.trim())}`
        : "";
    function view() {
      clear(
        body,
        table(
          [
            { label: "#", cell: (e) => String(e.id), class: "num" },
            { label: "Time", cell: (e) => when(e.at), class: "nowrap" },
            { label: "Action", cell: (e) => h("code", null, e.action) },
            { label: "By", cell: (e) => e.actor ?? "—" },
            {
              label: "Target",
              cell: (e) => (e.target ? h("code", null, e.target) : "—"),
            },
            { label: "From", cell: (e) => e.ip ?? "—" },
            {
              label: "Detail",
              cell: (e) =>
                e.detail
                  ? h("code", { class: "wrap" }, JSON.stringify(e.detail))
                  : "",
            },
          ],
          rows,
          { testid: "audit-table", empty: "No matching entries." },
        ),
      );
    }
    async function load(reset: boolean) {
      const before = reset || !rows.length ? "" : `&before=${rows.at(-1)!.id}`;
      const page = await get<{ entries: AuditEntry[] }>(
        `/api/audit?limit=100${before}${q()}`,
      );
      rows = reset ? page.entries : [...rows, ...page.entries];
      more.hidden = page.entries.length < 100;
      view();
    }
    more.addEventListener("click", () => void load(false));
    let t: ReturnType<typeof setTimeout> | undefined;
    filter.addEventListener("input", () => {
      clearTimeout(t);
      t = setTimeout(() => void load(true), 250);
    });

    ctx.root.append(
      pageHeader("Audit log", verify),
      h(
        "p",
        { class: "muted" },
        "Every security-relevant event, in a SHA-256 hash chain: editing or deleting an entry breaks the chain from that point. ",
        verdict,
      ),
      h("div", { class: "toolbar" }, filter),
      body,
      more,
    );
    await load(true);
  },
};
