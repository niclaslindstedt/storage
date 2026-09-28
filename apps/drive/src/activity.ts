// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Files syncing, as people see it: a status pill in the top bar ("Up to
// date", "Syncing…", "Offline") and the Activity page — what changed in
// your shared folders, on any device, as it happens.

import { ago, clear, h, when } from "@storage/console/dom.ts";
import { folderHref } from "@storage/remote/files/drives.ts";
import { baseName, parentOf } from "@storage/remote/files/tree.ts";

import type { Activity, SyncMonitor, SyncStatus } from "./sync.ts";

const LABEL: Record<SyncStatus["state"], string> = {
  connecting: "Connecting…",
  live: "Up to date",
  syncing: "Syncing…",
  offline: "Offline",
};

const DOT: Record<SyncStatus["state"], string> = {
  connecting: "dot",
  live: "dot ok",
  syncing: "dot syncing",
  offline: "dot fail",
};

/** The top bar's sync pill; links to the Activity page. */
export function syncPill(monitor: SyncMonitor): {
  el: HTMLElement;
  stop(): void;
} {
  const dot = h("span", { class: "dot", "aria-hidden": "true" });
  const text = h("span", null, "…");
  const el = h(
    "a",
    {
      class: "health-pill",
      href: "#/activity",
      "data-testid": "sync-status",
    },
    dot,
    text,
  );
  const draw = () => {
    const s = monitor.status;
    dot.className = DOT[s.state];
    text.textContent = LABEL[s.state];
    el.dataset.state = s.state;
    el.title =
      s.state === "offline"
        ? `${s.error ?? "Offline"} Retrying…`
        : s.syncedAt
          ? `Checked with the server ${ago(s.syncedAt)}`
          : "";
  };
  draw();
  return { el, stop: monitor.onChange(draw) };
}

const VERB: Record<Activity["kind"], string> = {
  added: "added",
  changed: "changed",
  deleted: "deleted",
  folder: "folder created",
};

export function renderActivity(
  root: HTMLElement,
  monitor: SyncMonitor,
): () => void {
  const state = h("div", { class: "sync-state", "data-testid": "sync-state" });
  const list = h("div");
  const draw = () => {
    const s = monitor.status;
    clear(
      state,
      h("span", { class: DOT[s.state], "aria-hidden": "true" }),
      h(
        "span",
        null,
        h("strong", null, LABEL[s.state]),
        s.state === "offline"
          ? ` — ${s.error ?? "the server cannot be reached"}. Retrying…`
          : s.syncedAt
            ? ` — checked with the server ${ago(s.syncedAt)}`
            : null,
      ),
    );
    clear(
      list,
      monitor.activity.length === 0
        ? h(
            "div",
            { class: "empty-state" },
            h("p", null, "Nothing has changed since you opened this page."),
            h(
              "p",
              { class: "muted" },
              "When a file is added, changed or deleted in one of your shared folders — here, on your phone, or by someone you share with — it shows up here at once.",
            ),
          )
        : h(
            "ul",
            { class: "file-list compact", "data-testid": "activity" },
            monitor.activity.map((a) =>
              h(
                "li",
                { "data-kind": a.kind },
                h("span", {
                  class: `icon ${a.kind === "folder" ? "folder" : "file"}`,
                  "aria-hidden": "true",
                }),
                h(
                  "span",
                  { class: "file-text" },
                  h(
                    "span",
                    { class: "file-name" },
                    a.kind === "deleted"
                      ? baseName(a.path)
                      : h(
                          "a",
                          {
                            href: folderHref(
                              a.ns,
                              a.kind === "folder" ? a.path : parentOf(a.path),
                            ),
                          },
                          baseName(a.path),
                        ),
                  ),
                  h(
                    "span",
                    { class: "file-sub" },
                    `${VERB[a.kind]} in ${[a.folder, parentOf(a.path)].filter(Boolean).join("/")}`,
                  ),
                ),
                h(
                  "time",
                  {
                    class: "file-sub",
                    datetime: new Date(a.at).toISOString(),
                    title: when(a.at),
                  },
                  ago(a.at),
                ),
              ),
            ),
          ),
    );
  };
  clear(
    root,
    h("div", { class: "page-header" }, h("h1", null, "Activity")),
    state,
    list,
  );
  draw();
  const stop = monitor.onChange(draw);
  const timer = setInterval(draw, 30_000);
  return () => {
    stop();
    clearInterval(timer);
  };
}
