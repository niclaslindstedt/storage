import { get } from "../api.ts";
import { badge, bytes, h, num, table, when } from "../dom.ts";
import { type Page, pageHeader, refresh } from "../page.ts";
import type { Namespace } from "../types.ts";

export const namespacesPage: Page = {
  id: "namespaces",
  label: "Namespaces",
  render(ctx) {
    const body = h("div", null, h("p", { class: "muted" }, "Loading…"));
    ctx.root.append(
      pageHeader("Namespaces"),
      h(
        "p",
        { class: "note" },
        "A namespace is one app's encrypted bucket. Its name, files, records and keys are end-to-end encrypted — what you see here is everything the server knows about it.",
      ),
      body,
    );
    ctx.every(30_000, () =>
      refresh(body, async () =>
        table(
          [
            { label: "App", cell: (n) => h("strong", null, n.app) },
            { label: "Owner", cell: (n) => n.owner },
            {
              label: "Members",
              cell: (n) =>
                h(
                  "ul",
                  { class: "plain" },
                  n.members.map((m) =>
                    h("li", null, `${m.name} `, badge(m.role)),
                  ),
                ),
            },
            { label: "Pending invites", cell: (n) => String(n.pendingInvites) },
            { label: "Stored", cell: (n) => bytes(n.usedBytes) },
            { label: "Changes", cell: (n) => num(n.seq) },
            { label: "Key epoch", cell: (n) => String(n.epoch) },
            {
              label: "Created",
              cell: (n) => when(n.createdAt),
              class: "nowrap",
            },
            {
              label: "Id",
              cell: (n) => h("code", { title: n.id }, `${n.id.slice(0, 10)}…`),
            },
          ],
          await get<Namespace[]>("/api/namespaces"),
          {
            testid: "namespaces-table",
            empty:
              "No namespaces yet. Apps create them when a person starts using them.",
          },
        ),
      ),
    );
  },
};
