// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The few UI pieces the app adds to the console's own (dom.ts): a full
// screen for the set-up steps, a QR code, and error text people can act on.

import { encodeQr } from "@niclaslindstedt/oss-framework/qr/encode";
import { qrToSvg } from "@niclaslindstedt/oss-framework/qr/svg";

import { type Child, h } from "@storage/console/dom.ts";

/** A centred set-up screen (connect, keys): title, lead, body. */
export function screen(title: string, lead: Child, ...body: Child[]) {
  return h(
    "main",
    { class: "setup", id: "main", tabindex: "-1" },
    h("div", { class: "brand setup-brand" }, [
      h("span", { class: "logo", "aria-hidden": "true" }),
      h("span", null, "Storage Remote"),
    ]),
    h("h1", null, title),
    h("p", { class: "lead" }, lead),
    ...body,
  );
}

/** A QR code as an image (the encoder is the framework's). */
export function qrImage(text: string, label: string) {
  const svg = qrToSvg(encodeQr(text, { ecl: "M" }));
  return h("img", {
    class: "qr",
    src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
    alt: label,
    width: 240,
    height: 240,
  });
}

/** An error as a sentence a person can act on. */
export function explain(err: unknown): string {
  const e = err as { name?: string; message?: string };
  const message = e?.message ?? String(err);
  if (e?.name === "TypeError" && /fetch|network|load/i.test(message))
    return "The server could not be reached. Check your connection and that the server is running.";
  if (e?.name === "QuotaExceededError")
    return "There is not enough room left in your storage quota.";
  return message;
}

/** A labelled field: label above, control below. */
export function field(id: string, label: string, control: HTMLElement) {
  control.id = id;
  return [h("label", { for: id }, label), control];
}
