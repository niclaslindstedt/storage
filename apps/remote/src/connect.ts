// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Pairing: the first thing the app shows. The code comes from the server's
// local admin console ("Pair admin app" on an admin account) or from
// `storage-server pair --account <you> --console`; it makes this phone an
// admin device. It is scanned (when the native wrapper offers a camera),
// pasted, or arrives in the address bar as an `#oss=` app link.

import {
  parseStoragePayload,
  type SelfHostedClient,
} from "@niclaslindstedt/oss-framework/storage/selfhosted";

import { h } from "@storage/console/dom.ts";

import { defaultDeviceName, platformOf } from "./client.ts";
import { onHost, scannerHost } from "./hosts.ts";
import { explain, field, screen } from "./ui.ts";

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
    value: defaultDeviceName(),
    "data-testid": "device-name",
  });
  const error = h("p", { class: "alert", role: "alert", hidden: true });
  const submit = h(
    "button",
    { type: "submit", class: "primary", "data-testid": "pair-submit" },
    "Connect",
  );
  const scan = h(
    "button",
    { type: "button", hidden: true, "data-testid": "pair-scan" },
    "Scan the code",
  );
  const showScan = () => (scan.hidden = scannerHost() === null);
  showScan();
  const stop = onHost(showScan);

  scan.addEventListener("click", async () => {
    try {
      const text = await scannerHost()?.scan();
      if (text) code.value = text;
    } catch (err) {
      fail(err);
    }
  });

  function fail(err: unknown) {
    error.textContent = explain(err);
    error.hidden = false;
    submit.disabled = false;
    submit.textContent = "Connect";
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
              "That is an invite to a shared folder. Connect with a pairing code first, then join it from Files.",
            );
        } catch (err) {
          return fail(err);
        }
        submit.disabled = true;
        submit.textContent = "Connecting…";
        try {
          await client.pair(payload, {
            name: name.value.trim() || defaultDeviceName(),
            platform: platformOf(),
          });
          stop();
          opts.onPaired();
        } catch (err) {
          fail(err);
        }
      },
    },
    error,
    ...field("pair-code", "Pairing code", code),
    ...field("pair-name", "Name this device", name),
    h("div", { class: "actions" }, scan, submit),
  );

  root.replaceChildren(
    screen(
      "Connect to your server",
      "Pair this phone as an admin device of your storage server. You can then run the server, add people and share folders from anywhere, and keep your own files on it, encrypted on this phone before they leave it.",
      h(
        "ol",
        { class: "steps" },
        h(
          "li",
          null,
          "On the computer running the server, open the admin console and go to ",
          h("strong", null, "Accounts"),
          ".",
        ),
        h(
          "li",
          null,
          "Press ",
          h("strong", null, "Pair admin app"),
          " on your account. Or run ",
          h("code", null, "storage-server pair --account <you> --console"),
          ".",
        ),
        h("li", null, "Scan the code, or paste the link below."),
      ),
      form,
      h(
        "p",
        { class: "muted small" },
        "The code signs this phone in and nothing more. Your encryption keys never pass through the server.",
      ),
    ),
  );
}
