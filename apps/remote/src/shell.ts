// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The signed-in app: three tabs over one hash. Files (`#/files…`) is the
// drive; Server is the admin console itself, its pages mounted unchanged
// (their ids — `#/overview`, `#/accounts`, … — are the console's); This
// phone (`#/phone`) is this device.

import type { SelfHostedClient } from "@niclaslindstedt/oss-framework/storage/selfhosted";

import { useTransport } from "@storage/console/api.ts";
import { card, h } from "@storage/console/dom.ts";
import { mountConsole, pageOf } from "@storage/console/shell.ts";

import { remoteTransport } from "./console.ts";
import { renderDevice } from "./device.ts";
import { renderBrowser } from "./files/browser.ts";
import { renderDrives } from "./files/drives.ts";

type View = "files" | "server" | "phone";

export type Route =
  | { view: "server" }
  | { view: "phone" }
  | { view: "files"; ns: string | null; folder: string };

/** What a hash shows. Anything unknown is the Files tab's start. */
export function routeOf(hash: string): Route {
  if (pageOf(hash)) return { view: "server" };
  const parts = hash.replace(/^#\/?/, "").split("/");
  if (parts[0] === "phone") return { view: "phone" };
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

const TABS: { view: View; label: string; href: string }[] = [
  { view: "files", label: "Files", href: "#/files" },
  { view: "server", label: "Server", href: "#/overview" },
  { view: "phone", label: "This phone", href: "#/phone" },
];

export function renderShell(
  root: HTMLElement,
  client: SelfHostedClient,
  opts: {
    admin: boolean;
    /** The user signed out on the This phone tab. */
    onSignedOut(): void;
    /** The server refused this phone's sign-in. */
    onLostAccess(): void;
    onReshow(): void;
  },
): () => void {
  const views: Record<View, HTMLElement> = {
    files: h("div", { class: "view", "data-view": "files" }),
    server: h("div", { class: "view", "data-view": "server" }),
    phone: h("div", { class: "view view-pad", "data-view": "phone" }),
  };
  const links = TABS.map((t) =>
    h(
      "a",
      { href: t.href, "data-tab": t.view, "data-testid": `tab-${t.view}` },
      h("span", { class: `tab-icon ${t.view}`, "aria-hidden": "true" }),
      h("span", null, t.label),
    ),
  );
  const tabs = h("nav", { class: "tabs", "aria-label": "App" }, links);
  root.replaceChildren(
    h("div", { class: "remote" }, views.files, views.server, views.phone, tabs),
  );

  // The console, reached as this admin device (SPEC §11.2).
  if (opts.admin) {
    useTransport(remoteTransport(client, opts.onLostAccess));
    mountConsole({
      root: views.server,
      serverName: client.session!.serverName ?? "storage",
      fallback: false,
    });
  } else {
    views.server.classList.add("view-pad");
    views.server.append(
      card(
        "This phone is not an admin device",
        h(
          "p",
          null,
          "It can use your files, but not run the server. To manage the server from here, pair this app again with a code from ",
          h("strong", null, "Pair admin app"),
          " in the local admin console, or from ",
          h("code", null, "storage-server pair --account <you> --console"),
          ".",
        ),
      ),
    );
  }

  let stop: () => void = () => {};
  let last = "";
  let lastServer = "#/overview";

  function route() {
    const r = routeOf(location.hash);
    const key = r.view === "files" ? `files:${r.ns ?? ""}:${r.folder}` : r.view;
    if (r.view === "server") lastServer = location.hash;
    links[1]!.setAttribute("href", lastServer);
    for (const a of links)
      if (a.dataset.tab === r.view) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    for (const [v, el] of Object.entries(views)) el.hidden = v !== r.view;
    if (key === last) return;
    last = key;
    stop();
    stop = () => {};
    if (r.view === "files")
      stop = r.ns
        ? renderBrowser(views.files, client, r.ns, r.folder)
        : renderDrives(views.files, client);
    else if (r.view === "phone")
      stop = renderDevice(views.phone, client, {
        admin: opts.admin,
        onSignedOut: opts.onSignedOut,
        onReshow: opts.onReshow,
      });
    window.scrollTo(0, 0);
  }

  window.addEventListener("hashchange", route);
  route();
  return () => {
    window.removeEventListener("hashchange", route);
    stop();
  };
}
