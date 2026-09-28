// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The key vault the page's framework client stores its keys in (SPEC §4.4):
// the iOS Keychain / Android Keystore through expo-secure-store, readable only
// while the phone is unlocked and never included in a backup or a transfer to
// a new phone (WHEN_UNLOCKED_THIS_DEVICE_ONLY). An admin device's keys stay
// on this phone.
//
// Secure-store keys allow [A-Za-z0-9._-] only, so an id is stored under its
// hex; and the store cannot list, so an index of ids (under INDEX) is kept
// for `clear(prefix)`.

import * as SecureStore from "expo-secure-store";

const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  keychainService: "storage-remote.keys",
};
const INDEX = "index";
const MAX_ID = 256;
const MAX_VALUE = 64 * 1024;

const keyOf = (id: string) =>
  "k." +
  Array.from(new TextEncoder().encode(id), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");

function checkId(id: unknown): string {
  if (typeof id !== "string" || id.length === 0 || id.length > MAX_ID)
    throw new Error("invalid key id");
  return id;
}

async function index(): Promise<string[]> {
  const raw = await SecureStore.getItemAsync(INDEX, OPTIONS);
  try {
    const ids = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(ids) ? ids.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

async function writeIndex(ids: string[]): Promise<void> {
  await SecureStore.setItemAsync(INDEX, JSON.stringify(ids), OPTIONS);
}

export async function vaultGet(id: unknown): Promise<string | null> {
  return SecureStore.getItemAsync(keyOf(checkId(id)), OPTIONS);
}

export async function vaultPut(id: unknown, value: unknown): Promise<void> {
  const key = checkId(id);
  if (typeof value !== "string" || value.length > MAX_VALUE)
    throw new Error("invalid key value");
  await SecureStore.setItemAsync(keyOf(key), value, OPTIONS);
  const ids = await index();
  if (!ids.includes(key)) await writeIndex([...ids, key]);
}

export async function vaultDelete(id: unknown): Promise<void> {
  const key = checkId(id);
  await SecureStore.deleteItemAsync(keyOf(key), OPTIONS);
  const ids = await index();
  if (ids.includes(key)) await writeIndex(ids.filter((x) => x !== key));
}

export async function vaultClear(prefix: unknown): Promise<void> {
  const p = typeof prefix === "string" ? prefix : "";
  const ids = await index();
  const gone = ids.filter((x) => x.startsWith(p));
  for (const id of gone) await SecureStore.deleteItemAsync(keyOf(id), OPTIONS);
  await writeIndex(ids.filter((x) => !x.startsWith(p)));
}
