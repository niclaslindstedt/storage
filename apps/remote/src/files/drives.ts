// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The Files tab's first level: the shared folders this account can open.
// A shared folder is one namespace of the "drive" app (SPEC §5) — its own
// key, shareable on its own. Its name is sealed like everything else; the
// server sees an id, an owner and a size.

import {
  parseStoragePayload,
  type SelfHostedClient,
  type StorageNamespaceInfo,
} from "@niclaslindstedt/oss-framework/storage/selfhosted";

import {
  badge,
  bytes,
  clear,
  confirm,
  dialog,
  h,
  toast,
} from "@storage/console/dom.ts";

import { DRIVE_APP } from "../client.ts";
import { scannerHost } from "../hosts.ts";
import { app, explain, field } from "../ui.ts";
import { nameProblem } from "./tree.ts";

export const folderHref = (id: string, path = "") =>
  `#/files/${encodeURIComponent(id)}${path ? `/${encodeURIComponent(path)}` : ""}`;

function newFolderDialog(client: SelfHostedClient, done: () => void) {
  const name = h("input", {
    autocomplete: "off",
    maxlength: "200",
    "data-testid": "folder-name",
  });
  const error = h("p", { class: "alert", role: "alert", hidden: true });
  const d = dialog(
    "New shared folder",
    h(
      "form",
      {
        async onsubmit(e: Event) {
          e.preventDefault();
          const problem = nameProblem(name.value);
          if (problem) {
            error.textContent = problem;
            error.hidden = false;
            return;
          }
          try {
            const ns = await client.createNamespace(
              { name: name.value },
              DRIVE_APP,
            );
            d.close();
            toast(`Created ${name.value}`, "ok");
            location.hash = folderHref(ns.id);
            done();
          } catch (err) {
            error.textContent = explain(err);
            error.hidden = false;
          }
        },
      },
      h(
        "p",
        { class: "muted" },
        "A shared folder has its own encryption key, so you can share it with someone without sharing anything else.",
      ),
      error,
      ...field("new-folder-name", "Name", name),
      h(
        "div",
        { class: "actions" },
        h("button", { type: "button", onclick: () => d.close() }, "Cancel"),
        h(
          "button",
          { type: "submit", class: "primary", "data-testid": "folder-create" },
          "Create",
        ),
      ),
    ),
    { testid: "new-folder-dialog" },
  );
  name.focus();
}

function joinDialog(client: SelfHostedClient, done: () => void) {
  const code = h("textarea", {
    rows: 3,
    spellcheck: "false",
    placeholder: "oss-storage://invite?v=1&s=…",
    "data-testid": "invite-payload",
  });
  const error = h("p", { class: "alert", role: "alert", hidden: true });
  const scanner = scannerHost();
  const d = dialog(
    "Join a shared folder",
    h(
      "form",
      {
        async onsubmit(e: Event) {
          e.preventDefault();
          try {
            const p = parseStoragePayload(code.value);
            if (p.kind !== "invite")
              throw new Error("That is a pairing code, not an invite.");
            if (p.server !== client.session!.serverUrl)
              throw new Error(
                "That invite is for another server. This app is connected to " +
                  client.session!.serverUrl,
              );
            const { namespace } = await client.acceptInvite(p);
            d.close();
            toast(`Joined ${namespace.meta.name}`, "ok");
            done();
          } catch (err) {
            error.textContent = explain(err);
            error.hidden = false;
          }
        },
      },
      h(
        "p",
        { class: "muted" },
        "Someone shared a folder with you: scan or paste the invite they showed you.",
      ),
      error,
      ...field("invite-code", "Invite", code),
      h(
        "div",
        { class: "actions" },
        scanner
          ? h(
              "button",
              {
                type: "button",
                async onclick() {
                  const text = await scanner.scan().catch(() => null);
                  if (text) code.value = text;
                },
              },
              "Scan",
            )
          : null,
        h("button", { type: "button", onclick: () => d.close() }, "Cancel"),
        h("button", { type: "submit", class: "primary" }, "Join"),
      ),
    ),
  );
  code.focus();
}

async function leaveOrDelete(
  client: SelfHostedClient,
  info: StorageNamespaceInfo,
  done: () => void,
) {
  const owner = info.role === "owner";
  const ok = await confirm({
    title: owner ? `Delete ${info.meta.name}?` : `Leave ${info.meta.name}?`,
    message: owner
      ? "This deletes the folder and every file in it, for everyone it is shared with. It cannot be undone."
      : "The folder disappears from your list. The owner can invite you again.",
    action: owner ? "Delete folder" : "Leave",
    danger: true,
    typed: owner ? info.meta.name : undefined,
  });
  if (!ok) return;
  try {
    const ns = await client.namespace(info.id);
    if (owner) await ns.delete();
    else await ns.leave();
    toast(owner ? `Deleted ${info.meta.name}` : `Left ${info.meta.name}`, "ok");
  } catch (err) {
    toast(explain(err), "fail");
  }
  done();
}

export function renderDrives(
  root: HTMLElement,
  client: SelfHostedClient,
): () => void {
  const list = h("div", null, h("p", { class: "muted" }, "Loading…"));
  const load = async () => {
    try {
      const folders = await client.namespaces(DRIVE_APP);
      folders.sort((a, b) =>
        String(a.meta.name).localeCompare(String(b.meta.name)),
      );
      clear(
        list,
        folders.length === 0
          ? h(
              "div",
              { class: "empty-state" },
              h("p", null, "No folders yet."),
              h(
                "p",
                { class: "muted" },
                `Create a shared folder for your files. Everything in it is encrypted on this ${app.device} before it is uploaded.`,
              ),
            )
          : h(
              "ul",
              { class: "file-list", "data-testid": "drive-list" },
              folders.map((f) =>
                h(
                  "li",
                  { "data-testid": `drive-${f.meta.name}` },
                  h(
                    "a",
                    { class: "file-main", href: folderHref(f.id) },
                    h("span", { class: "icon folder", "aria-hidden": "true" }),
                    h(
                      "span",
                      { class: "file-text" },
                      h("span", { class: "file-name" }, f.meta.name),
                      h(
                        "span",
                        { class: "file-sub" },
                        bytes(f.usedBytes),
                        " ",
                        f.role === "owner"
                          ? null
                          : badge(`shared with you · ${f.role}`, "info"),
                      ),
                    ),
                  ),
                  h(
                    "button",
                    {
                      type: "button",
                      class: "icon-button",
                      "aria-label":
                        f.role === "owner"
                          ? `Delete ${f.meta.name}`
                          : `Leave ${f.meta.name}`,
                      onclick: () => leaveOrDelete(client, f, load),
                    },
                    "✕",
                  ),
                ),
              ),
            ),
      );
    } catch (err) {
      clear(list, h("p", { class: "alert", role: "alert" }, explain(err)));
    }
  };

  clear(
    root,
    h(
      "div",
      { class: "page-header" },
      h("h1", null, "Files"),
      h(
        "div",
        { class: "row-actions" },
        h(
          "button",
          { type: "button", onclick: () => joinDialog(client, load) },
          "Join",
        ),
        h(
          "button",
          {
            type: "button",
            class: "primary",
            "data-testid": "new-drive",
            onclick: () => newFolderDialog(client, load),
          },
          "New folder",
        ),
      ),
    ),
    list,
  );
  void load();
  // Membership changes (someone shared a folder with you) arrive live.
  return client.subscribe((e) => {
    if (e.type === "namespaces") void load();
  });
}
