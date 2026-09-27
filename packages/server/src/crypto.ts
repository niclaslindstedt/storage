// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The server's only cryptography: checking that a device's public keys are
// valid P-256 points and verifying its ECDSA signatures. The server never
// encrypts or decrypts user data (SPEC §4).

import { webcrypto } from "node:crypto";

import { badRequest } from "./errors.ts";
import { fromB64u, utf8 } from "./util/b64.ts";
import { sha256 } from "./util/random.ts";

const subtle = webcrypto.subtle;

/** Import a raw (65-byte uncompressed) P-256 public key, or throw 400. */
export async function importP256Public(
  b64u: string,
  kind: "ecdsa" | "ecdh",
  what: string,
): Promise<webcrypto.CryptoKey> {
  let raw: Uint8Array;
  try {
    raw = fromB64u(b64u);
  } catch {
    throw badRequest(`${what} must be base64url`);
  }
  if (raw.byteLength !== 65 || raw[0] !== 0x04) {
    throw badRequest(`${what} must be an uncompressed P-256 point`);
  }
  try {
    return await subtle.importKey(
      "raw",
      raw,
      kind === "ecdsa"
        ? { name: "ECDSA", namedCurve: "P-256" }
        : { name: "ECDH", namedCurve: "P-256" },
      true,
      kind === "ecdsa" ? ["verify"] : [],
    );
  } catch {
    throw badRequest(`${what} is not a valid P-256 key`);
  }
}

/** Verify an ECDSA P-256 / SHA-256 signature (IEEE P1363, 64 bytes). */
export async function verifySignature(
  publicKeyB64u: string,
  signatureB64u: string,
  message: string,
): Promise<boolean> {
  let sig: Uint8Array;
  try {
    sig = fromB64u(signatureB64u);
  } catch {
    return false;
  }
  if (sig.byteLength !== 64) return false;
  const key = await importP256Public(publicKeyB64u, "ecdsa", "device key");
  return subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    sig,
    utf8(message),
  );
}

/** The message a device signs to authenticate (SPEC §6.1). */
export function authMessage(
  serverId: string,
  deviceId: string,
  challenge: string,
): string {
  return `oss-storage/v1/auth|${serverId}|${deviceId}|${challenge}`;
}

/**
 * The code two devices compare before one hands its account key to the
 * other: 25 decimal digits (~83 bits) from SHA-256 over both public keys, in
 * groups of five. Long enough that a malicious server cannot grind a key pair
 * whose code matches.
 */
export function safetyCode(dskPublic: string, dekPublic: string): string {
  const digest = sha256(
    new Uint8Array([...fromB64u(dskPublic), ...fromB64u(dekPublic)]),
  );
  const groups: string[] = [];
  for (let g = 0; g < 5; g++) {
    const n =
      ((digest[g * 4]! << 24) |
        (digest[g * 4 + 1]! << 16) |
        (digest[g * 4 + 2]! << 8) |
        digest[g * 4 + 3]!) >>>
      0;
    groups.push(String(n % 100000).padStart(5, "0"));
  }
  return groups.join(" ");
}
