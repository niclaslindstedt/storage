// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Signing in: this browser becomes a device of your account (SPEC §9).
// There are no passwords — a sign-in code does it: one the server's admin
// made for you (console → Accounts → "Pair device", or
// `storage-server pair --account <you>`), or one a device you already use
// shows (Storage Remote → This phone → "Add a device"), which also brings
// your encryption key along. It is pasted, or arrives in the address bar
// as an `#oss=` link.

import {
  parseStoragePayload,
  type SelfHostedClient,
} from "@niclaslindstedt/oss-framework/storage/selfhosted";

import { h } from "@storage/console/dom.ts";
import { explain, field, screen } from "@storage/remote/ui.ts";

/** What this browser calls itself, e.g. "Firefox on Mac". */
export function browserName(ua = navigator.userAgent): string {
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Firefox\//.test(ua)
      ? "Firefox"
      : /Chrome\//.test(ua)
        ? "Chrome"
        : /Safari\//.test(ua)
          ? "Safari"
          : "Browser";
  const os = /iPhone|iPad/.test(ua)
    ? "iOS"
    : /Android/.test(ua)
      ? "Android"
      : /Mac OS X/.test(ua)
        ? "Mac"
        : /Windows/.test(ua)
          ? "Windows"
          : /Linux/.test(ua)
            ? "Linux"
            : null;
  return os ? `${browser} on ${os}` : browser;
}

export function renderConnect(
  root: HTMLElement,
  client: SelfHostedClient,
  opts: { payload?: string; onPaired(): void },
): void {
  const code = h("textarea", {
    rows: 3,
    spellcheck: "false",
    autocomplete: "off",
    placeholder: "oss-storage://pair?v=1&s=…",
    "data-testid": "pair-payload",
  });
  code.value = opts.payload ?? "";
  const name = h("input", {
    autocomplete: "off",
    maxlength: "64",
    value: browserName(),
    "data-testid": "device-name",
  });
  const error = h("p", { class: "alert", role: "alert", hidden: true });
  const submit = h(
    "button",
    { type: "submit", class: "primary", "data-testid": "pair-submit" },
    "Sign in",
  );

  function fail(err: unknown) {
    error.textContent = explain(err);
    error.hidden = false;
    submit.disabled = false;
    submit.textContent = "Sign in";
  }

  const form = h(
    "form",
    {
      class: "stack",
      async onsubmit(e: Event) {
        e.preventDefault();
        error.hidden = true;
        let payload;
        try {
          payload = parseStoragePayload(code.value);
          if (payload.kind !== "pair")
            throw new Error(
              "That is an invite to a shared folder. Sign in with a sign-in code first, then join the folder.",
            );
          if (
            location.protocol === "https:" &&
            payload.server.startsWith("http:") &&
            !/^http:\/\/(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(
              payload.server,
            )
          )
            throw new Error(
              `Your server (${payload.server}) speaks plain HTTP, which a secure page cannot reach. Give it a certificate (storage-server --tls acme), or use a copy of this page served from the same network.`,
            );
        } catch (err) {
          return fail(err);
        }
        submit.disabled = true;
        submit.textContent = "Signing in…";
        try {
          await client.pair(payload, {
            name: name.value.trim() || browserName(),
            platform: "web",
          });
          opts.onPaired();
        } catch (err) {
          fail(err);
        }
      },
    },
    error,
    ...field("pair-code", "Sign-in code", code),
    ...field("pair-name", "Name this browser", name),
    h("div", { class: "actions" }, submit),
  );

  root.replaceChildren(
    screen(
      "Sign in to your files",
      "Your files live on your own storage server, encrypted. Sign this browser in to browse, upload and share them, and to watch them sync — they are decrypted here, never on the server.",
      form,
      h(
        "section",
        { class: "card" },
        h("h2", null, "Where do I get a sign-in code?"),
        h(
          "ul",
          { class: "steps" },
          h(
            "li",
            null,
            h("strong", null, "From a device you already use: "),
            "in Storage Remote, open ",
            h("strong", null, "This phone → Add a device"),
            " and paste the code it shows. Your encryption key comes along.",
          ),
          h(
            "li",
            null,
            h("strong", null, "From whoever runs the server: "),
            "the admin console's ",
            h("strong", null, "Accounts → Pair device"),
            ", or ",
            h("code", null, "storage-server pair --account <you>"),
            ". You then unlock your files with your recovery key, or approve this browser from another device.",
          ),
        ),
      ),
      h(
        "p",
        { class: "muted small" },
        "The code signs this browser in and nothing more. It only works once and expires after ten minutes. Your keys stay in this browser, and you can sign it out at any time.",
      ),
    ),
  );
  code.focus();
}
