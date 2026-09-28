import { copy, dialog, h, when } from "../dom.ts";
import type { Pairing } from "../types.ts";

/** Show a pairing QR code with its expiry countdown and copyable payload. */
export function showPairing(
  p: Pairing,
  who: string,
  kind: "device" | "admin" | "agent" = "device",
): void {
  const left = h("strong", { "data-testid": "pairing-countdown" });
  const tick = () => {
    const s = Math.max(0, Math.round((p.expiresAt - Date.now()) / 1000));
    left.textContent =
      s === 0
        ? "expired"
        : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  };
  tick();
  const timer = setInterval(tick, 1000);
  const src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(p.svg)}`;
  const d = dialog(
    kind === "admin"
      ? `Pair the admin app — ${who}`
      : kind === "agent"
        ? `Pair an agent — ${who}`
        : `Pair a device — ${who}`,
    h(
      "div",
      { class: "pairing" },
      h("img", {
        src,
        alt: "Pairing QR code",
        class: "qr",
        width: 280,
        height: 280,
        "data-testid": "pairing-qr",
      }),
      h(
        "div",
        null,
        kind === "agent"
          ? h(
              "p",
              null,
              "On the agent's machine, run ",
              h("code", null, "storage-mcp pair '<the code below>'"),
              ". It then needs the account key: approve it from Storage Remote (This phone) after comparing safety codes, or give it the recovery key. The code works once and expires in ",
              left,
              ` (${when(p.expiresAt)}).`,
            )
          : kind === "admin"
            ? h(
                "p",
                null,
                "Open the storage remote app on your phone and scan this code. The phone becomes an ",
                h("strong", null, "admin device"),
                ": it can do everything this console does, from anywhere. The code works once and expires in ",
                left,
                ` (${when(p.expiresAt)}).`,
              )
            : h(
                "p",
                null,
                "Open the app, choose ",
                h("strong", null, "Self-hosted"),
                ", and scan this code. It works once and expires in ",
                left,
                ` (${when(p.expiresAt)}).`,
              ),
        h(
          "p",
          { class: "muted" },
          "The code only signs the device in. Encryption keys never pass through this server: a new device gets them from another device of the same account, or from the recovery key.",
        ),
        h("label", { for: "pairing-payload" }, "Or paste into the app"),
        h(
          "div",
          { class: "row" },
          h("input", {
            id: "pairing-payload",
            readonly: true,
            value: p.payload,
            "data-testid": "pairing-payload",
          }),
          h(
            "button",
            { type: "button", onclick: () => copy(p.payload) },
            "Copy",
          ),
        ),
      ),
    ),
    { testid: "pairing-dialog", wide: true },
  );
  d.el.addEventListener("close", () => clearInterval(timer));
}
