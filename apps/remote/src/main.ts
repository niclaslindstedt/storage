// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Storage Remote: the hoster's own app for their storage server — the admin
// console, and an end-to-end encrypted drive — as one admin device (SPEC
// §11.2). Boot: restore the device from its keystore, then pair, set up
// keys, or open the app. A pairing link opened as `…#oss=<payload>` fills
// in the pairing code and is wiped from the address bar at once.

import "@storage/console/styles.css";
import "./common.css";
import "./styles.css";

import { h, toast } from "@storage/console/dom.ts";

import { createClient, isAdminDevice } from "./client.ts";
import { renderConnect } from "./connect.ts";
import { renderKeys } from "./keys.ts";
import { renderShell } from "./shell.ts";
import { screen, explain } from "./ui.ts";

const root = document.getElementById("app")!;
const client = createClient();
let stopShell: () => void = () => {};

/** Take a pairing link out of the address bar (it holds a secret). */
function takeLinkPayload(): string | undefined {
  const i = location.hash.indexOf("#oss=");
  if (i < 0) return undefined;
  const payload = location.href;
  history.replaceState(null, "", `${location.pathname}${location.search}`);
  return payload;
}

async function signedOut() {
  stopShell();
  await client.signOut({ forget: true }).catch(() => {});
  location.hash = "";
  renderConnect(root, client, { onPaired: () => void boot() });
}

/**
 * The server turned this phone away (revoked, or its account disabled).
 * Its keys are erased only when the user says so: a disabled account can be
 * enabled again, and then this phone just carries on.
 */
function lostAccess() {
  stopShell();
  root.replaceChildren(
    screen(
      "The server turned this phone away",
      "It may have been revoked, or your account disabled. If it was revoked, pair it again. If your account was disabled, enable it on the server and try again.",
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
          "Forget this phone and pair again",
        ),
      ),
    ),
  );
}

async function boot(payload = takeLinkPayload()) {
  stopShell();
  const state = await client.restore();
  if (state === "signed-out") {
    renderConnect(root, client, { payload, onPaired: () => void boot() });
    return;
  }
  // Never let a link wipe a paired phone's keys: that takes a deliberate
  // sign-out on the This phone tab.
  if (payload)
    setTimeout(
      () =>
        toast(
          "This phone is already paired. To pair it again, sign out on the This phone tab first.",
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
  let admin = true;
  try {
    admin = await isAdminDevice(client);
  } catch (err) {
    if ((err as Error).name === "AuthError") return lostAccess();
    // Offline: open the app anyway; the pages say what they cannot reach.
    console.warn(explain(err));
  }
  stopShell = renderShell(root, client, {
    admin,
    onSignedOut: () => void signedOut(),
    onLostAccess: lostAccess,
    onReshow: () => void boot(),
  });
}

window.addEventListener("hashchange", () => {
  if (location.hash.startsWith("#oss=")) void boot();
});

void boot();
