// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Capabilities a native host may offer the page (apps/remote/native). The
// page never asks whether it runs inside the wrapper — only whether a
// capability is there — so the same build works in a browser, where each
// falls back to what the web can do:
//
// - a QR scanner (`__storageRemoteScanner`): scan the console's pairing
//   code or an invite with the camera. The web falls back to pasting.
// - a share sheet (`__storageRemoteShare`): hand a decrypted file to the
//   phone (save to Files, AirDrop, open in another app). The web downloads.
//
// The keystore is the framework's own seam (`__ossKeyVault`, SPEC §4.4).

export const SCANNER_PROPERTY = "__storageRemoteScanner";
export const SCANNER_EVENT = "storage-remote:scanner";
export const SHARE_PROPERTY = "__storageRemoteShare";
export const SHARE_EVENT = "storage-remote:share";

export type ScannerHost = {
  readonly version: 1;
  /** Open the camera; resolves with the scanned text, or null if cancelled. */
  scan(): Promise<string | null>;
};

export type ShareHost = {
  readonly version: 1;
  /** Offer a file to the system share sheet; `data` is base64 (standard). */
  share(file: { name: string; type: string; data: string }): Promise<void>;
};

function host<T>(property: string, methods: string[]): T | null {
  if (typeof window === "undefined") return null;
  const h = (window as unknown as Record<string, unknown>)[property] as
    Record<string, unknown> | undefined;
  if (!h || typeof h !== "object" || h.version !== 1) return null;
  for (const m of methods) if (typeof h[m] !== "function") return null;
  return h as T;
}

export const scannerHost = () => host<ScannerHost>(SCANNER_PROPERTY, ["scan"]);
export const shareHost = () => host<ShareHost>(SHARE_PROPERTY, ["share"]);

/** Call `fn` whenever a host announces itself (it may arrive after load). */
export function onHost(fn: () => void): () => void {
  window.addEventListener(SCANNER_EVENT, fn);
  window.addEventListener(SHARE_EVENT, fn);
  return () => {
    window.removeEventListener(SCANNER_EVENT, fn);
    window.removeEventListener(SHARE_EVENT, fn);
  };
}

/** Standard base64 of bytes, in chunks (a large file would blow the stack). */
export function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Hand bytes to the user: the native share sheet, or a browser download. */
export async function saveFile(
  name: string,
  type: string,
  bytes: Uint8Array,
): Promise<void> {
  const share = shareHost();
  if (share) {
    await share.share({ name, type, data: toBase64(bytes) });
    return;
  }
  const url = URL.createObjectURL(
    new Blob([bytes as BlobPart], { type: type || "application/octet-stream" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
