// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The web drive: your files on your storage server, in any browser — like
// Dropbox, except that everything is encrypted in this browser and the
// server only ever holds ciphertext. Boot: restore this browser's device
// from its key vault (IndexedDB, non-extractable keys), then sign in, set
// up keys, or open the drive. A sign-in link opened as `…#oss=<payload>`
// fills in the code and is wiped from the address bar at once.

import "@storage/console/styles.css";
import "@storage/remote/common.css";
import "./styles.css";

import {
  createSelfHostedClient,
  defaultKeyVault,
} from "@niclaslindstedt/oss-framework/storage/selfhosted";

import { h, toast } from "@storage/console/dom.ts";
import { DRIVE_APP } from "@storage/remote/client.ts";
import { renderKeys } from "@storage/remote/keys.ts";
import { configureApp, screen } from "@storage/remote/ui.ts";

import { renderConnect } from "./connect.ts";
import { renderShell } from "./shell.ts";

configureApp({ name: "Storage", device: "browser" });

const root = document.getElementById("app")!;
// Its own key vault: the same browser can also run Storage Remote.
const client = createSelfHostedClient({
  vault: defaultKeyVault("storage-drive"),
  app: DRIVE_APP,
});
let stopShell: () => void = () => {};

/** Take a sign-in link out of the address bar (it holds a secret). */
function takeLinkPayload(): string | undefined {
  const i = location.hash.indexOf("#oss=");
  if (i < 0) return undefined;
  const payload = location.href;
  history.replaceState(null, "", `${location.pathname}${location.search}`);
  return payload;
}

async function signedOut() {
  stopShell();
  stopShell = () => {};
  await client.signOut({ forget: true }).catch(() => {});
  location.hash = "";
  renderConnect(root, client, { onPaired: () => void boot() });
}

/** The server turned this browser away (revoked, or the account disabled). */
function lostAccess() {
  stopShell();
  stopShell = () => {};
  root.replaceChildren(
    screen(
      "The server turned this browser away",
      "It may have been signed out from another device, or your account disabled. Sign in again, or ask whoever runs the server.",
      h(
        "div",
        { class: "actions" },
        h(
          "button",
          { type: "button", onclick: () => void boot() },
          "Try again",
        ),
        h(
          "button",
          {
            type: "button",
            class: "danger",
            "data-testid": "pair-again",
            onclick: () => void signedOut(),
          },
          "Forget this browser and sign in again",
        ),
      ),
    ),
  );
}

async function boot(payload = takeLinkPayload()) {
  stopShell();
  stopShell = () => {};
  const state = await client.restore();
  if (state === "signed-out") {
    renderConnect(root, client, { payload, onPaired: () => void boot() });
    return;
  }
  if (payload)
    setTimeout(
      () =>
        toast(
          "This browser is already signed in. To use another account, sign out on This browser first.",
          "warn",
        ),
      500,
    );
  if (state === "needs-keys") {
    await renderKeys(root, client, {
      onReady: () => void boot(),
      onSignOut: () => void signedOut(),
    });
    return;
  }
  stopShell = renderShell(root, client, {
    onSignedOut: () => void signedOut(),
    onLostAccess: lostAccess,
    onReshow: () => void boot(),
  });
}

window.addEventListener("hashchange", () => {
  if (location.hash.startsWith("#oss=")) void boot();
});

void boot();
