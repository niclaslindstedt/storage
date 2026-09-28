// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Encryption keys, after pairing (SPEC §4.3). The pairing code signs the
// phone in; the account key comes from one of three places, never from the
// server: it is created here (the account's first device, which then shows
// the recovery key once), recovered from the recovery key, or handed over
// by another device of the account after both show the same safety code.

import type { SelfHostedClient } from "@niclaslindstedt/oss-framework/storage/selfhosted";

import { copy, h } from "@storage/console/dom.ts";

import { explain, field, screen } from "./ui.ts";

/** Show a new recovery key once; resolves when the user has kept it. */
export function showRecoveryKey(
  root: HTMLElement,
  key: string,
  opts: { title: string; done(): void },
): void {
  const kept = h("input", { type: "checkbox", "data-testid": "rk-kept" });
  const next = h(
    "button",
    {
      type: "button",
      class: "primary",
      disabled: true,
      onclick: opts.done,
      "data-testid": "rk-done",
    },
    "Continue",
  );
  kept.addEventListener("change", () => (next.disabled = !kept.checked));
  root.replaceChildren(
    screen(
      opts.title,
      "This recovery key is the only way back to your files if you lose every device. Write it down or keep it in a password manager. It is shown once, and the server never sees it.",
      h("p", { class: "recovery-key", "data-testid": "recovery-key" }, key),
      h(
        "div",
        { class: "actions start" },
        h("button", { type: "button", onclick: () => copy(key) }, "Copy"),
      ),
      h(
        "label",
        { class: "check" },
        kept,
        " I have stored the recovery key somewhere safe",
      ),
      h("div", { class: "actions" }, next),
    ),
  );
}

export async function renderKeys(
  root: HTMLElement,
  client: SelfHostedClient,
  opts: { onReady(): void; onSignOut(): void },
): Promise<void> {
  root.replaceChildren(screen("Setting up encryption", "One moment…"));
  let hasKeys: boolean;
  try {
    hasKeys = await client.accountHasKeys();
  } catch (err) {
    root.replaceChildren(
      screen(
        "Setting up encryption",
        explain(err),
        h(
          "div",
          { class: "actions" },
          h(
            "button",
            {
              type: "button",
              onclick: () => void renderKeys(root, client, opts),
            },
            "Try again",
          ),
        ),
      ),
    );
    return;
  }

  const error = h("p", { class: "alert", role: "alert", hidden: true });
  const fail = (err: unknown) => {
    error.textContent = explain(err);
    error.hidden = false;
  };
  let stopWaiting = () => {};
  const signOut = h(
    "button",
    {
      type: "button",
      class: "link",
      onclick: () => {
        stopWaiting();
        opts.onSignOut();
      },
    },
    "Use another pairing code",
  );

  if (!hasKeys) {
    const create = h(
      "button",
      { type: "button", class: "primary", "data-testid": "create-keys" },
      "Create my encryption key",
    );
    create.addEventListener("click", async () => {
      create.disabled = true;
      try {
        const key = await client.createAccountKeys();
        showRecoveryKey(root, key, {
          title: "Your recovery key",
          done: opts.onReady,
        });
      } catch (err) {
        create.disabled = false;
        fail(err);
      }
    });
    root.replaceChildren(
      screen(
        "Create your encryption key",
        "This is the first device of your account, so it creates the key everything you store is encrypted with. Your other devices get it from this one.",
        error,
        h("div", { class: "actions" }, create),
        signOut,
      ),
    );
    return;
  }

  // The account has a key on another device: approval or the recovery key.
  const abort = new AbortController();
  stopWaiting = () => abort.abort();
  const code = h("p", { class: "safety-code", "data-testid": "safety-code" });
  void client.safetyCode().then((c) => (code.textContent = c));
  void client
    .waitForApproval({ signal: abort.signal })
    .then((state) => {
      if (state === "ready") opts.onReady();
    })
    .catch(fail);

  const rk = h("input", {
    autocomplete: "off",
    spellcheck: "false",
    placeholder: "XXXX-XXXX-…",
    "data-testid": "rk-input",
  });
  const recover = h(
    "form",
    {
      class: "stack",
      async onsubmit(e: Event) {
        e.preventDefault();
        try {
          await client.recover(rk.value);
          abort.abort();
          opts.onReady();
        } catch (err) {
          fail(err);
        }
      },
    },
    ...field("rk", "Recovery key", rk),
    h(
      "div",
      { class: "actions" },
      h(
        "button",
        { type: "submit", class: "primary", "data-testid": "rk-submit" },
        "Unlock with the recovery key",
      ),
    ),
  );

  root.replaceChildren(
    screen(
      "Unlock your files",
      "Your account already has an encryption key. Get it onto this phone in one of two ways.",
      error,
      h(
        "section",
        { class: "card" },
        h("h2", null, "Approve from another device"),
        h(
          "p",
          null,
          "On a device that already has your files, open its device settings and approve this phone. Check that it shows this safety code:",
        ),
        code,
        h(
          "p",
          { class: "muted small" },
          "Waiting for approval… This screen moves on by itself.",
        ),
      ),
      h(
        "section",
        { class: "card" },
        h("h2", null, "Use your recovery key"),
        recover,
      ),
      signOut,
    ),
  );
}
