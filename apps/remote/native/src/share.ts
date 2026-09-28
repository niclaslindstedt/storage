// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The share sheet: the page hands over a file it has just decrypted, the
// wrapper writes it to the app's cache, opens the system sheet (save to
// Files, AirDrop, open in another app) and deletes the copy when the sheet
// closes — the phone keeps no plaintext the user did not choose to keep.

import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";

const MAX_BYTES = 512 * 1024 * 1024;

/** A file name safe for the cache directory (no path, no control chars). */
export function safeName(name: unknown): string {
  const text = typeof name === "string" ? name : "";
  const cleaned = text
    .replace(/[\u0000-\u001f\u007f/\\:]/g, "_")
    .replace(/^\.+/, "")
    .trim()
    .slice(0, 180);
  return cleaned || "file";
}

export async function shareFile(file: unknown): Promise<void> {
  const f = file as { name?: unknown; type?: unknown; data?: unknown } | null;
  if (!f || typeof f.data !== "string") throw new Error("nothing to share");
  if ((f.data.length * 3) / 4 > MAX_BYTES)
    throw new Error("that file is too large to share from the app");
  if (!(await Sharing.isAvailableAsync()))
    throw new Error("sharing is not available on this device");
  const dir = `${FileSystem.cacheDirectory}share-${Date.now()}/`;
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  const uri = dir + safeName(f.name);
  try {
    await FileSystem.writeAsStringAsync(uri, f.data, {
      encoding: FileSystem.EncodingType.Base64,
    });
    await Sharing.shareAsync(uri, {
      mimeType: typeof f.type === "string" && f.type ? f.type : undefined,
      dialogTitle: safeName(f.name),
    });
  } finally {
    await FileSystem.deleteAsync(dir, { idempotent: true });
  }
}
