import { del, get, isRemote, patch, post } from "../api.ts";
import { ago, badge, bytes, confirm, dialog, h, table, toast } from "../dom.ts";
import { type Page, pageHeader, refresh } from "../page.ts";
import type { Account, Pairing } from "../types.ts";
import { showPairing } from "./pairing.ts";

const ROLES = ["member", "admin", "guest"] as const;
const ROLE_HELP = {
  admin: "manages the server and every account",
  member: "creates namespaces and shares them",
  guest: "only sees namespaces shared with it",
};

function roleSelect(id: string, value: string) {
  return h(
    "select",
    { id, name: "role", "data-testid": "role-select" },
    ROLES.map((r) =>
      h(
        "option",
        { value: r, selected: r === value },
        `${r} — ${ROLE_HELP[r]}`,
      ),
    ),
  );
}

/** Quota input in GiB; empty = unlimited. */
function quotaInput(id: string, value: number | null) {
  return h("input", {
    id,
    name: "quota",
    type: "number",
    min: "0",
    step: "0.1",
    placeholder: "unlimited",
    value:
      value === null ? "" : String(Math.round((value / 1024 ** 3) * 100) / 100),
    "data-testid": "quota-input",
  });
}

function quotaBytes(v: string): number | null {
  if (v.trim() === "") return null;
  return Math.round(Number(v) * 1024 ** 3);
}

function usage(a: Account) {
  const pct = a.quotaBytes
    ? Math.min(100, (a.usedBytes / a.quotaBytes) * 100)
    : 0;
  const bar = h("div", { class: "meter" }, h("span"));
  (bar.firstChild as HTMLElement).style.width = `${pct}%`;
  if (pct > 90) bar.classList.add("fail");
  else if (pct > 75) bar.classList.add("warn");
  return h(
    "div",
    null,
    `${bytes(a.usedBytes)} of ${a.quotaBytes === null ? "unlimited" : bytes(a.quotaBytes)}`,
    a.quotaBytes ? bar : null,
  );
}

async function pair(a: Account) {
  try {
    showPairing(await post<Pairing>(`/api/accounts/${a.id}/pairing`), a.name);
  } catch (err) {
    toast((err as Error).message, "fail");
  }
}

/** An admin device for the remote app (SPEC §11.2); only at the machine. */
async function pairAdminApp(a: Account) {
  try {
    showPairing(
      await post<Pairing>(`/api/accounts/${a.id}/pairing`, { console: true }),
      a.name,
      "admin",
    );
  } catch (err) {
    toast((err as Error).message, "fail");
  }
}

function accountForm(opts: {
  title: string;
  submit: string;
  account?: Account;
  withPairing?: boolean;
  onSubmit(v: {
    name: string;
    role: string;
    quotaBytes: number | null;
    pair: boolean;
  }): Promise<void>;
}) {
  const a = opts.account;
  const name = h("input", {
    id: "acc-name",
    name: "name",
    required: true,
    autocomplete: "off",
    maxlength: "64",
    value: a?.name ?? "",
    "data-testid": "name-input",
  });
  const role = roleSelect("acc-role", a?.role ?? "member");
  const quota = quotaInput("acc-quota", a?.quotaBytes ?? null);
  const pairNow = h("input", {
    id: "acc-pair",
    type: "checkbox",
    checked: true,
    "data-testid": "pair-now",
  });
  const error = h("p", { class: "alert", hidden: true, role: "alert" });
  const form = h(
    "form",
    {
      onsubmit: async (e: Event) => {
        e.preventDefault();
        try {
          await opts.onSubmit({
            name: name.value.trim(),
            role: role.value,
            quotaBytes: quotaBytes(quota.value),
            pair: pairNow.checked,
          });
          d.close();
        } catch (err) {
          error.textContent = (err as Error).message;
          error.hidden = false;
        }
      },
    },
    error,
    h("label", { for: "acc-name" }, "Name"),
    name,
    h("label", { for: "acc-role" }, "Role"),
    role,
    h(
      "label",
      { for: "acc-quota" },
      "Storage quota (GiB, empty for unlimited)",
    ),
    quota,
    opts.withPairing
      ? h(
          "label",
          { class: "check", for: "acc-pair" },
          pairNow,
          " Show a pairing QR code for the first device",
        )
      : null,
    h(
      "div",
      { class: "actions" },
      h("button", { type: "button", onclick: () => d.close() }, "Cancel"),
      h(
        "button",
        { type: "submit", class: "primary", "data-testid": "submit" },
        opts.submit,
      ),
    ),
  );
  const d = dialog(opts.title, form, { testid: "account-dialog" });
  name.focus();
}

export const accountsPage: Page = {
  id: "accounts",
  label: "Accounts",
  render(ctx) {
    const body = h("div", null, h("p", { class: "muted" }, "Loading…"));
    const load = () =>
      refresh(body, async () => view(await get<Account[]>("/api/accounts")));

    const create = h(
      "button",
      {
        type: "button",
        class: "primary",
        "data-testid": "new-account",
        onclick: () =>
          accountForm({
            title: "New account",
            submit: "Create",
            withPairing: true,
            async onSubmit(v) {
              const acc = await post<Account>("/api/accounts", {
                name: v.name,
                role: v.role,
                quotaBytes: v.quotaBytes,
              });
              toast(`Created ${acc.name}`, "ok");
              await load();
              if (v.pair)
                await pair({
                  ...acc,
                  devices: 0,
                  namespaces: 0,
                  lastSeenAt: null,
                });
            },
          }),
      },
      "New account",
    );

    function edit(a: Account) {
      accountForm({
        title: `Edit ${a.name}`,
        submit: "Save",
        account: a,
        async onSubmit(v) {
          await patch(`/api/accounts/${a.id}`, {
            name: v.name,
            role: v.role,
            quotaBytes: v.quotaBytes,
          });
          toast("Saved", "ok");
          await load();
        },
      });
    }

    async function toggle(a: Account) {
      if (
        !a.disabled &&
        !(await confirm({
          title: `Disable ${a.name}?`,
          message:
            "Its devices are signed out and cannot sign in until you enable the account again. No data is deleted.",
          action: "Disable",
          danger: true,
        }))
      )
        return;
      try {
        await patch(`/api/accounts/${a.id}`, { disabled: !a.disabled });
        toast(a.disabled ? `Enabled ${a.name}` : `Disabled ${a.name}`, "ok");
      } catch (err) {
        toast((err as Error).message, "fail");
      }
      await load();
    }

    async function remove(a: Account) {
      const ok = await confirm({
        title: `Delete ${a.name}?`,
        message: `This deletes the account, its ${a.devices} device(s) and the ${a.namespaces} namespace(s) it owns — for every member they are shared with. It cannot be undone.`,
        action: "Delete account",
        danger: true,
        typed: a.name,
      });
      if (!ok) return;
      try {
        await del(`/api/accounts/${a.id}`, { confirm: a.name });
        toast(`Deleted ${a.name}`, "ok");
      } catch (err) {
        toast((err as Error).message, "fail");
      }
      await load();
    }

    function view(list: Account[]) {
      return table(
        [
          {
            label: "Name",
            cell: (a) => [
              h("strong", null, a.name),
              a.devices === 0
                ? h("div", { class: "hint" }, "no device paired yet")
                : a.hasKeys
                  ? null
                  : h(
                      "div",
                      { class: "hint" },
                      "first device has not set up keys yet",
                    ),
            ],
          },
          {
            label: "Role",
            cell: (a) => badge(a.role, a.role === "admin" ? "info" : "muted"),
          },
          {
            label: "State",
            cell: (a) =>
              a.disabled ? badge("disabled", "fail") : badge("active", "ok"),
          },
          { label: "Storage", cell: usage },
          {
            label: "Devices",
            cell: (a) =>
              h(
                "a",
                { href: `#/devices?account=${encodeURIComponent(a.name)}` },
                String(a.devices),
              ),
          },
          { label: "Namespaces", cell: (a) => String(a.namespaces) },
          {
            label: "Last seen",
            cell: (a) => ago(a.lastSeenAt),
            class: "nowrap",
          },
          {
            label: "",
            class: "actions-cell",
            cell: (a) =>
              h(
                "div",
                { class: "row-actions" },
                h(
                  "button",
                  {
                    type: "button",
                    onclick: () => pair(a),
                    "data-testid": "pair",
                  },
                  "Pair device",
                ),
                a.role === "admin" && !a.disabled && !isRemote()
                  ? h(
                      "button",
                      {
                        type: "button",
                        onclick: () => pairAdminApp(a),
                        "data-testid": "pair-admin-app",
                        title:
                          "Pair the remote app on your phone as an admin device",
                      },
                      "Pair admin app",
                    )
                  : null,
                h(
                  "button",
                  {
                    type: "button",
                    onclick: () => edit(a),
                    "data-testid": "edit",
                  },
                  "Edit",
                ),
                h(
                  "button",
                  {
                    type: "button",
                    onclick: () => toggle(a),
                    "data-testid": "toggle",
                  },
                  a.disabled ? "Enable" : "Disable",
                ),
                h(
                  "button",
                  {
                    type: "button",
                    class: "danger",
                    onclick: () => remove(a),
                    "data-testid": "delete",
                  },
                  "Delete",
                ),
              ),
          },
        ],
        list,
        {
          testid: "accounts-table",
          empty: "No accounts yet. Create one and pair its first device.",
          rowTestid: (a) => `account-${a.name}`,
        },
      );
    }

    ctx.root.append(
      pageHeader("Accounts", create),
      h(
        "p",
        { class: "muted" },
        "People who use this server. Sharing a single namespace does not need an account here: the app's invite QR creates a guest.",
      ),
      body,
    );
    ctx.every(15_000, load);
  },
};
