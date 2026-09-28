// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Sharing a folder (SPEC §6.3): an invite is a QR code carrying a secret the
// server never sees; the folder's keys travel sealed under it. People with
// an account on the server join with it; anyone else becomes a guest that
// sees only this folder. Removing someone rotates the folder's key, so they
// cannot read anything written after.

import type { StorageNamespace } from "@niclaslindstedt/oss-framework/storage/selfhosted";

import {
  badge,
  clear,
  confirm,
  copy,
  dialog,
  h,
  toast,
  when,
} from "@storage/console/dom.ts";

import { shareHost, toBase64 } from "../hosts.ts";
import { explain, field, qrImage } from "../ui.ts";

const TTL = [
  { label: "1 hour", seconds: 3600 },
  { label: "1 day", seconds: 86_400 },
  { label: "7 days", seconds: 7 * 86_400 },
];

function showInvite(payload: string, expiresAt: number, folder: string) {
  const share = shareHost();
  dialog(
    `Invite to ${folder}`,
    h(
      "div",
      { class: "pairing" },
      qrImage(payload, "Invite QR code"),
      h(
        "div",
        null,
        h(
          "p",
          null,
          "Let them scan this in their app, or send them the link. It stops working ",
          when(expiresAt),
          ".",
        ),
        h(
          "p",
          { class: "muted" },
          "Anyone holding this link can join, so send it only to them.",
        ),
        ...field(
          "invite-link",
          "Link",
          h("input", {
            readonly: true,
            value: payload,
            "data-testid": "invite-link",
          }),
        ),
        h(
          "div",
          { class: "actions start" },
          h("button", { type: "button", onclick: () => copy(payload) }, "Copy"),
          share
            ? h(
                "button",
                {
                  type: "button",
                  onclick: () =>
                    share
                      .share({
                        name: `${folder} invite.txt`,
                        type: "text/plain",
                        data: toBase64(new TextEncoder().encode(payload)),
                      })
                      .catch((err: unknown) => toast(explain(err), "fail")),
                },
                "Send…",
              )
            : null,
        ),
      ),
    ),
    { wide: true, testid: "invite-dialog" },
  );
}

export function openSharing(ns: StorageNamespace): void {
  const folder = String(ns.meta.name);
  const members = h("div", null, h("p", { class: "muted" }, "Loading…"));
  const invites = h("div");
  const role = h(
    "select",
    { "data-testid": "invite-role" },
    h("option", { value: "viewer" }, "Can view"),
    h("option", { value: "editor" }, "Can edit"),
  );
  const ttl = h(
    "select",
    null,
    TTL.map((t) =>
      h(
        "option",
        { value: String(t.seconds), selected: t.seconds === 86_400 },
        t.label,
      ),
    ),
  );

  const load = async () => {
    try {
      const [m, i] = await Promise.all([ns.members(), ns.invites()]);
      clear(
        members,
        h(
          "ul",
          { class: "file-list compact", "data-testid": "members" },
          m.map((x) =>
            h(
              "li",
              null,
              h(
                "span",
                { class: "file-text" },
                h("span", { class: "file-name" }, x.name),
                h("span", { class: "file-sub" }, badge(x.role)),
              ),
              x.role === "owner"
                ? null
                : h(
                    "button",
                    {
                      type: "button",
                      class: "danger",
                      async onclick() {
                        const ok = await confirm({
                          title: `Remove ${x.name}?`,
                          message:
                            "They lose access now. The folder gets a new key, so nothing written from now on can be read with what they already have.",
                          action: "Remove",
                          danger: true,
                        });
                        if (!ok) return;
                        try {
                          await ns.removeMember(x.accountId);
                          toast(`Removed ${x.name}`, "ok");
                        } catch (err) {
                          toast(explain(err), "fail");
                        }
                        await load();
                      },
                    },
                    "Remove",
                  ),
            ),
          ),
        ),
      );
      const live = i.filter(
        (x) => !x.revoked && x.uses < x.maxUses && x.expiresAt > Date.now(),
      );
      clear(
        invites,
        live.length
          ? [
              h("h3", null, "Open invites"),
              h(
                "ul",
                { class: "file-list compact" },
                live.map((x) =>
                  h(
                    "li",
                    null,
                    h(
                      "span",
                      { class: "file-text" },
                      h("span", { class: "file-name" }, x.role),
                      h(
                        "span",
                        { class: "file-sub" },
                        `expires ${when(x.expiresAt)}`,
                      ),
                    ),
                    h(
                      "button",
                      {
                        type: "button",
                        async onclick() {
                          await ns.revokeInvite(x.id);
                          await load();
                        },
                      },
                      "Revoke",
                    ),
                  ),
                ),
              ),
            ]
          : null,
      );
    } catch (err) {
      clear(members, h("p", { class: "alert" }, explain(err)));
    }
  };

  dialog(
    `Share ${folder}`,
    h(
      "div",
      { class: "stack" },
      h("h3", null, "People"),
      members,
      invites,
      h("h3", null, "Invite someone"),
      h(
        "form",
        {
          class: "stack",
          async onsubmit(e: Event) {
            e.preventDefault();
            try {
              const out = await ns.invite({
                role: role.value as "viewer" | "editor",
                ttlSeconds: Number(ttl.value),
                maxUses: 1,
              });
              showInvite(out.payload, out.expiresAt, folder);
              await load();
            } catch (err) {
              toast(explain(err), "fail");
            }
          },
        },
        ...field("invite-role-select", "Access", role),
        ...field("invite-ttl", "Valid for", ttl),
        h(
          "div",
          { class: "actions" },
          h(
            "button",
            {
              type: "submit",
              class: "primary",
              "data-testid": "invite-create",
            },
            "Create invite",
          ),
        ),
      ),
    ),
    { wide: true, testid: "share-dialog" },
  );
  void load();
}
