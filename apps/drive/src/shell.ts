// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The signed-in drive: a top bar (server, sync status, this browser), a
// sidebar with your shared folders, and the page. The folder pages are
// Storage Remote's own (`#/files…`), so the phone and the browser behave
// the same; Activity (`#/activity`) and This browser (`#/device`) are here.

import type { SelfHostedClient } from "@niclaslindstedt/oss-framework/storage/selfhosted";

import { clear, h } from "@storage/console/dom.ts";
import { DRIVE_APP } from "@storage/remote/client.ts";
import { renderDevice } from "@storage/remote/device.ts";
import { renderBrowser } from "@storage/remote/files/browser.ts";
import { folderHref, renderDrives } from "@storage/remote/files/drives.ts";

import { renderActivity, syncPill } from "./activity.ts";
import { clientSource, SyncMonitor } from "./sync.ts";

export type Route =
  | { view: "activity" }
  | { view: "device" }
  | { view: "files"; ns: string | null; folder: string };

/** What a hash shows. Anything unknown is the list of shared folders. */
export function routeOf(hash: string): Route {
  const parts = hash.replace(/^#\/?/, "").split("/");
  if (parts[0] === "activity") return { view: "activity" };
  if (parts[0] === "device") return { view: "device" };
  if (parts[0] === "files" && parts[1]) {
    try {
      return {
        view: "files",
        ns: decodeURIComponent(parts[1]),
        folder: parts[2] ? decodeURIComponent(parts[2]) : "",
      };
    } catch {
      // a damaged link: show the list
    }
  }
  return { view: "files", ns: null, folder: "" };
}

export function renderShell(
  root: HTMLElement,
  client: SelfHostedClient,
  opts: { onSignedOut(): void; onLostAccess(): void; onReshow(): void },
): () => void {
  const session = client.session!;
  const monitor = new SyncMonitor(clientSource(client));
  const pill = syncPill(monitor);
  const folders = h("ul", { "data-testid": "sidebar-folders" });
  const nav = h(
    "nav",
    { class: "sidebar drive-nav", "aria-label": "Drive" },
    h(
      "ul",
      null,
      h(
        "li",
        null,
        h("a", { href: "#/files", "data-nav": "files" }, "All folders"),
      ),
      h("li", null, folders),
      h(
        "li",
        { class: "nav-sep" },
        h("a", { href: "#/activity", "data-nav": "activity" }, "Activity"),
      ),
      h(
        "li",
        null,
        h("a", { href: "#/device", "data-nav": "device" }, "This browser"),
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
        { class: "brand", href: "#/files" },
        h("span", { class: "logo", "aria-hidden": "true" }),
        h("span", null, "Storage"),
        h(
          "span",
          { class: "version", title: session.serverUrl },
          session.serverName ?? new URL(session.serverUrl).host,
        ),
      ),
      pill.el,
    ),
    h("div", { class: "layout" }, nav, main),
  );

  // The sidebar's folders, kept current as folders are shared or removed.
  let folderIds: string[] = [];
  async function loadFolders() {
    try {
      const list = await client.namespaces(DRIVE_APP);
      list.sort((a, b) =>
        String(a.meta.name).localeCompare(String(b.meta.name)),
      );
      folderIds = list.map((f) => f.id);
      clear(
        folders,
        list.map((f) =>
          h(
            "li",
            null,
            h(
              "a",
              { href: folderHref(f.id), "data-ns": f.id, class: "nav-folder" },
              h("span", { class: "icon folder", "aria-hidden": "true" }),
              h("span", null, String(f.meta.name)),
            ),
          ),
        ),
      );
      mark();
    } catch {
      // Offline: the pill says so; the list fills in on the next change.
    }
  }

  function mark() {
    const r = routeOf(location.hash);
    for (const a of nav.querySelectorAll<HTMLAnchorElement>("a")) {
      const on =
        a.dataset.ns !== undefined
          ? r.view === "files" && r.ns === a.dataset.ns
          : a.dataset.nav === r.view &&
            (r.view !== "files" || r.ns === null || !folderIds.includes(r.ns));
      if (on) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    }
  }

  let stop: () => void = () => {};
  let last = "";
  function route() {
    const r = routeOf(location.hash);
    mark();
    const key = r.view === "files" ? `files:${r.ns ?? ""}:${r.folder}` : r.view;
    if (key === last) return;
    last = key;
    stop();
    stop = () => {};
    if (r.view === "files")
      stop = r.ns
        ? renderBrowser(main, client, r.ns, r.folder)
        : renderDrives(main, client);
    else if (r.view === "activity") stop = renderActivity(main, monitor);
    else
      stop = renderDevice(main, client, {
        admin: null,
        onSignedOut: opts.onSignedOut,
        onReshow: opts.onReshow,
      });
    main.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }

  const online = () => monitor.setOnline(true);
  const offline = () => monitor.setOnline(false);
  window.addEventListener("hashchange", route);
  window.addEventListener("online", online);
  window.addEventListener("offline", offline);
  const unsubscribe = client.subscribe((e) => {
    if (e.type === "namespaces") void loadFolders();
    if (e.type === "device" && e.revoked) opts.onLostAccess();
  });
  // A revoked browser's requests fail to sign in: say so, not "offline".
  const stopWatch = monitor.onChange(() => {
    if (monitor.status.lostAccess) opts.onLostAccess();
  });
  void loadFolders();
  void monitor.start();
  route();

  return () => {
    window.removeEventListener("hashchange", route);
    window.removeEventListener("online", online);
    window.removeEventListener("offline", offline);
    unsubscribe();
    stopWatch();
    pill.stop();
    monitor.stop();
    stop();
  };
}
