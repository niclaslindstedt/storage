import { del, get } from "../api.ts";
import { ago, badge, confirm, h, table, toast, toneOf, when } from "../dom.ts";
import { type Page, pageHeader, refresh } from "../page.ts";
import type { Device } from "../types.ts";

export const devicesPage: Page = {
  id: "devices",
  label: "Devices",
  render(ctx) {
    const params = new URLSearchParams(location.hash.split("?")[1] ?? "");
    const search = h("input", {
      type: "search",
      placeholder: "Filter by device, account or platform",
      "aria-label": "Filter devices",
      value: params.get("account") ?? "",
      "data-testid": "device-filter",
    });
    const state = h(
      "select",
      { "aria-label": "State" },
      ["all", "active", "pending", "revoked"].map((s) =>
        h(
          "option",
          { value: s, selected: s === "all" },
          s === "all" ? "All states" : s,
        ),
      ),
    );
    const body = h("div", null, h("p", { class: "muted" }, "Loading…"));
    let devices: Device[] = [];

    async function revoke(d: Device) {
      const ok = await confirm({
        title: `Revoke ${d.name}?`,
        message: `${d.account}'s device is signed out now and can never sign in again. Its keys are deleted from the server. To use it again, pair it as a new device.`,
        action: "Revoke",
        danger: true,
      });
      if (!ok) return;
      try {
        await del(`/api/devices/${d.id}`);
        toast(`Revoked ${d.name}`, "ok");
      } catch (err) {
        toast((err as Error).message, "fail");
      }
      await load();
    }

    function view() {
      const q = search.value.trim().toLowerCase();
      const rows = devices.filter(
        (d) =>
          (state.value === "all" || d.state === state.value) &&
          (!q ||
            `${d.name} ${d.account} ${d.platform}`.toLowerCase().includes(q)),
      );
      return table(
        [
          { label: "Device", cell: (d) => h("strong", null, d.name) },
          { label: "Account", cell: (d) => d.account },
          { label: "Platform", cell: (d) => d.platform },
          {
            label: "State",
            cell: (d) => [
              badge(d.state, toneOf(d.state)),
              d.state === "pending"
                ? h(
                    "div",
                    { class: "hint" },
                    "waiting for keys from another device or the recovery key",
                  )
                : null,
            ],
          },
          {
            label: "App origin",
            cell: (d) => (d.origin ? h("code", null, d.origin) : "—"),
          },
          { label: "Paired", cell: (d) => when(d.createdAt), class: "nowrap" },
          {
            label: "Last seen",
            cell: (d) =>
              d.revokedAt ? `revoked ${ago(d.revokedAt)}` : ago(d.lastSeenAt),
            class: "nowrap",
          },
          {
            label: "",
            class: "actions-cell",
            cell: (d) =>
              d.state === "revoked"
                ? null
                : h(
                    "button",
                    {
                      type: "button",
                      class: "danger",
                      onclick: () => revoke(d),
                      "data-testid": "revoke",
                    },
                    "Revoke",
                  ),
          },
        ],
        rows,
        {
          testid: "devices-table",
          empty: devices.length
            ? "No device matches the filter."
            : "No devices yet.",
          rowTestid: (d) => `device-${d.name}`,
        },
      );
    }
    const load = () =>
      refresh(body, async () => {
        devices = await get<Device[]>("/api/devices");
        return view();
      });
    const rerender = () => refresh(body, async () => view());
    search.addEventListener("input", rerender);
    state.addEventListener("change", rerender);

    ctx.root.append(
      pageHeader("Devices"),
      h("div", { class: "toolbar" }, search, state),
      body,
    );
    ctx.every(15_000, load);
  },
};
