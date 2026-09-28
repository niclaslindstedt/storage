// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Opening a file: decrypted on this device and shown in a dialog — text as
// text, pictures as pictures — with its versions and a download a tap away.
// Anything else is offered as a download. Nothing is rendered as HTML: text
// goes in as text, and a picture is shown from a local blob: URL.

import type {
  NamespaceFileInfo,
  StorageNamespace,
} from "@niclaslindstedt/oss-framework/storage/selfhosted";

import { bytes, clear, dialog, h, toast, when } from "@storage/console/dom.ts";

import { saveFile, shareHost } from "../hosts.ts";
import { explain } from "../ui.ts";
import { decodeText, looksLikeText } from "./diff.ts";
import { baseName } from "./tree.ts";

/** Picture types a browser shows safely from a blob: URL (no SVG: it can script). */
const IMAGE = /^image\/(png|jpe?g|gif|webp|avif|bmp)$/;
/** Larger files are not previewed (they are decrypted into memory). */
const MAX_PREVIEW_BYTES = 20 * 1024 * 1024;
const MAX_TEXT_CHARS = 200_000;

export function canPreview(f: { path: string; mime?: string; size: number }) {
  return (
    f.size <= MAX_PREVIEW_BYTES &&
    ((!!f.mime && IMAGE.test(f.mime)) ||
      looksLikeText(baseName(f.path), f.mime))
  );
}

export function openPreview(opts: {
  ns: StorageNamespace;
  file: NamespaceFileInfo;
  onVersions(): void;
}): void {
  const { file } = opts;
  const name = baseName(file.path);
  const body = h(
    "div",
    { class: "preview", "data-testid": "preview" },
    h("p", { class: "muted" }, "Decrypting…"),
  );
  let data: Uint8Array | null = null;
  let url: string | null = null;
  const d = dialog(
    name,
    h(
      "div",
      null,
      h(
        "p",
        { class: "muted small" },
        `${bytes(file.size)} · changed ${when(file.mtime)}`,
      ),
      body,
      h(
        "div",
        { class: "actions" },
        h(
          "button",
          {
            type: "button",
            onclick: () => {
              d.close();
              opts.onVersions();
            },
          },
          "Versions",
        ),
        h(
          "button",
          {
            type: "button",
            class: "primary",
            "data-testid": "preview-download",
            async onclick() {
              try {
                data ??= (await opts.ns.files.read(file.path))?.bytes ?? null;
                if (!data) throw new Error("The file is gone.");
                await saveFile(name, file.mime ?? "", data);
              } catch (err) {
                toast(explain(err), "fail");
              }
            },
          },
          shareHost() ? "Save or share" : "Download",
        ),
      ),
    ),
    { wide: true, testid: "preview-dialog" },
  );
  d.el.addEventListener("close", () => {
    if (url) URL.revokeObjectURL(url);
  });

  void (async () => {
    try {
      const got = await opts.ns.files.read(file.path);
      if (!got) throw new Error("The file is gone. Someone may have moved it.");
      data = got.bytes;
      if (file.mime && IMAGE.test(file.mime)) {
        url = URL.createObjectURL(
          new Blob([data as BlobPart], { type: file.mime }),
        );
        clear(body, h("img", { src: url, alt: name, class: "preview-image" }));
        return;
      }
      const text = decodeText(data);
      if (text === null) {
        clear(
          body,
          h("p", { class: "muted" }, "There is no preview for this file."),
        );
        return;
      }
      clear(
        body,
        h(
          "pre",
          { class: "preview-text", "data-testid": "preview-text" },
          text.length > MAX_TEXT_CHARS
            ? `${text.slice(0, MAX_TEXT_CHARS)}\n…`
            : text,
        ),
      );
    } catch (err) {
      clear(body, h("p", { class: "alert", role: "alert" }, explain(err)));
    }
  })();
}
