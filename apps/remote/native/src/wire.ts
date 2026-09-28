// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The bridge's wire: what the page posts and what the wrapper answers. This
// file IMPORTS NOTHING — the storage repo's tests load it (and bridge.ts)
// with no Expo installed, and a type-only import of a native module would
// still break that there.
//
// A failure crosses as DATA, never as a thrown error: the only way back into
// the page is an injected script, and an exception thrown there is swallowed
// by the WebView instead of reaching the waiting promise.

export const BRIDGE_MESSAGE = "storage-remote/bridge";
export const BRIDGE_GLOBAL = "__storageRemoteBridge";

export const BRIDGE_OPS = [
  "vault.get",
  "vault.put",
  "vault.delete",
  "vault.clear",
  "scan",
  "share",
] as const;

export type BridgeOp = (typeof BRIDGE_OPS)[number];

export type BridgeRequest = {
  type: typeof BRIDGE_MESSAGE;
  id: string;
  op: BridgeOp;
  args: unknown[];
};

export type BridgeResult =
  { ok: true; value: unknown } | { ok: false; error: string };

export function isBridgeRequest(value: unknown): value is BridgeRequest {
  const v = value as Partial<BridgeRequest> | null;
  return (
    typeof v === "object" &&
    v !== null &&
    v.type === BRIDGE_MESSAGE &&
    typeof v.id === "string" &&
    v.id.length > 0 &&
    v.id.length <= 64 &&
    (BRIDGE_OPS as readonly string[]).includes(v.op as string) &&
    Array.isArray(v.args)
  );
}

/** A value as JavaScript source safe to inject into the page. */
export function scriptLiteral(value: unknown): string {
  return JSON.stringify(value)
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029")
    .replace(/<\/(script)/gi, "<\\/$1");
}
