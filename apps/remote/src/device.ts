// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// This phone as a device of your account: what it is paired to, the devices
// of your account waiting for your encryption key (approve them only when
// the safety codes match), adding another device by QR, a new recovery key,
// and signing out.

import type { SelfHostedClient } from "@niclaslindstedt/oss-framework/storage/selfhosted";

import {
  ago,
  badge,
  card,
  clear,
  confirm,
  dialog,
  h,
  kv,
  toast,
} from "@storage/console/dom.ts";

import { showRecoveryKey } from "./keys.ts";
import { app, cap, explain, qrImage } from "./ui.ts";

export function renderDevice(
  root: HTMLElement,
  client: SelfHostedClient,
  opts: {
    /** Whether this is an admin device; null leaves the row out (the web drive). */
    admin: boolean | null;
    onSignedOut(): void;
    onReshow(): void;
  },
): () => void {
  const s = client.session!;
  const pending = h("div", null, h("p", { class: "muted" }, "Loading…"));
  const devices = h("div");
  const code = h("code", { "data-testid": "own-safety-code" }, "…");
  void client.safetyCode().then((c) => (code.textContent = c));

  const load = async () => {
    try {
      const [waiting, all] = await Promise.all([
        client.pendingDevices(),
        client.devices(),
      ]);
      clear(
        pending,
        waiting.length === 0
          ? h("p", { class: "muted" }, "No device is waiting.")
          : h(
              "ul",
              { class: "file-list compact", "data-testid": "pending-devices" },
              waiting.map((d) =>
                h(
                  "li",
                  null,
                  h(
                    "span",
                    { class: "file-text" },
                    h("span", { class: "file-name" }, d.name),
                    h(
                      "span",
                      { class: "file-sub" },
                      "Safety code ",
                      h("code", null, d.safetyCode),
                    ),
                  ),
                  h(
                    "button",
                    {
                      type: "button",
                      class: "primary",
                      async onclick() {
                        const ok = await confirm({
                          title: `Approve ${d.name}?`,
                          message: `Only if ${d.name} shows exactly this safety code: ${d.safetyCode}. If it does not, someone else is trying to join your account: revoke it instead.`,
                          action: "Codes match — approve",
                        });
                        if (!ok) return;
                        try {
                          await client.approveDevice(d.id);
                          toast(`${d.name} can now open your files`, "ok");
                        } catch (err) {
                          toast(explain(err), "fail");
                        }
                        await load();
                      },
                    },
                    "Approve",
                  ),
                ),
              ),
            ),
      );
      const live = all.filter((d) => d.revokedAt === null);
      clear(
        devices,
        h(
          "ul",
          { class: "file-list compact" },
          live.map((d) =>
            h(
              "li",
              null,
              h(
                "span",
                { class: "file-text" },
                h(
                  "span",
                  { class: "file-name" },
                  d.name,
                  d.id === s.deviceId
                    ? [" ", badge(`this ${app.device}`, "info")]
                    : null,
                ),
                h(
                  "span",
                  { class: "file-sub" },
                  `${d.platform} · last seen ${ago(d.lastSeenAt)}`,
                ),
              ),
              d.id === s.deviceId
                ? null
                : h(
                    "button",
                    {
                      type: "button",
                      class: "danger",
                      async onclick() {
                        const ok = await confirm({
                          title: `Revoke ${d.name}?`,
                          message:
                            "It is signed out now and its copy of your key is deleted. Lost a phone? This is the button.",
                          action: "Revoke",
                          danger: true,
                        });
                        if (!ok) return;
                        await client
                          .revokeDevice(d.id)
                          .catch((err: unknown) => toast(explain(err), "fail"));
                        await load();
                      },
                    },
                    "Revoke",
                  ),
            ),
          ),
        ),
      );
    } catch (err) {
      clear(pending, h("p", { class: "alert" }, explain(err)));
    }
  };

  async function addDevice() {
    try {
      const { payload, expiresAt } = await client.addDevicePayload({
        ttlSeconds: 600,
      });
      dialog(
        "Add a device",
        h(
          "div",
          { class: "pairing" },
          qrImage(payload, "Pairing QR code"),
          h(
            "p",
            null,
            "Scan this with the new device's app. It carries your key sealed under a secret only this code holds, so the new device is ready at once. It works once, until ",
            new Date(expiresAt).toLocaleTimeString(),
            ".",
          ),
        ),
        { wide: true },
      );
    } catch (err) {
      toast(explain(err), "fail");
    }
  }

  async function newRecoveryKey() {
    const ok = await confirm({
      title: "Make a new recovery key?",
      message:
        "The old recovery key stops working at once. Do this if you think someone saw it.",
      action: "Make a new key",
      danger: true,
    });
    if (!ok) return;
    try {
      const key = await client.regenerateRecoveryKey();
      showRecoveryKey(root, key, {
        title: "Your new recovery key",
        done: opts.onReshow,
      });
    } catch (err) {
      toast(explain(err), "fail");
    }
  }

  async function signOut() {
    const ok = await confirm({
      title: `Sign out and forget this ${app.device}?`,
      message: `This ${app.device}'s keys are erased and it has to be paired again. Your files stay on the server.`,
      action: "Sign out",
      danger: true,
    });
    if (!ok) return;
    await client.signOut({ forget: true });
    opts.onSignedOut();
  }

  clear(
    root,
    h(
      "div",
      { class: "page-header" },
      h("h1", null, cap(`this ${app.device}`)),
    ),
    card(
      null,
      kv([
        ["Server", h("code", null, s.serverUrl)],
        ["Server name", s.serverName ?? "—"],
        ["Device", h("code", null, s.deviceId)],
        ...(opts.admin === null
          ? []
          : [
              [
                "Admin",
                opts.admin
                  ? badge("admin device", "info")
                  : badge("not an admin device", "warn"),
              ] as [string, HTMLElement],
            ]),
        ["Safety code", code],
      ]),
    ),
    card("Waiting for your key", pending),
    card("Your devices", devices),
    card(
      "Keys",
      h(
        "div",
        { class: "row-actions wrap" },
        h(
          "button",
          { type: "button", onclick: () => void addDevice() },
          "Add a device",
        ),
        h(
          "button",
          { type: "button", onclick: () => void newRecoveryKey() },
          "New recovery key",
        ),
        h(
          "button",
          {
            type: "button",
            class: "danger",
            "data-testid": "sign-out",
            onclick: () => void signOut(),
          },
          "Sign out",
        ),
      ),
    ),
  );
  void load();
  const timer = setInterval(() => void load(), 15_000);
  return () => clearInterval(timer);
}
