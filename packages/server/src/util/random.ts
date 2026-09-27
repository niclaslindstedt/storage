// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Randomness, hashing and constant-time comparison. Every secret the server
// mints is 256 bits; every id is 128 bits; secrets are only ever stored as
// their SHA-256.

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { toB64u } from "./b64.ts";

/** A 128-bit random id with a readable type prefix, e.g. `acc_…`. */
export function newId(prefix: string): string {
  return `${prefix}_${toB64u(randomBytes(16))}`;
}

/** A 256-bit random secret, base64url. */
export function newSecret(): string {
  return toB64u(randomBytes(32));
}

export function sha256(data: string | Uint8Array): Uint8Array {
  return new Uint8Array(createHash("sha256").update(data).digest());
}

export function sha256B64u(data: string | Uint8Array): string {
  return toB64u(sha256(data));
}

export function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

/** Compare two strings without leaking where they differ. Lengths are
 *  compared via their hashes so unequal lengths take the same time. */
export function constantTimeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb) && a.length === b.length;
}
