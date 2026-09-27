// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Pairing / invite payloads (SPEC §9) — what a QR code carries. The same
// format is parsed by the framework client.

export type PairingPayload = {
  server: string;
  code: string;
  name?: string;
  /** SHA-256 of the TLS certificate's public key (native pinning). */
  fp?: string;
};

export function pairingUri(p: PairingPayload): string {
  const q = new URLSearchParams({ v: "1", s: p.server, c: p.code });
  if (p.name) q.set("n", p.name);
  if (p.fp) q.set("fp", p.fp);
  return `oss-storage://pair?${q.toString()}`;
}

/** Wrap a payload as an app link so a phone camera opens the app directly. */
export function appLink(appUrl: string, payload: string): string {
  return `${appUrl}#oss=${Buffer.from(payload, "utf8").toString("base64url")}`;
}
