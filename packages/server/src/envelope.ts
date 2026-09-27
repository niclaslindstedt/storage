// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The only part of a client ciphertext the server reads: the 9-byte `OSE1`
// header (SPEC §4.3). It carries the key epoch, which lets the server insist
// that every write after a key rotation uses the new key — so a removed
// member's old key never protects new data.

import { badRequest } from "./errors.ts";

export const ENVELOPE_MAGIC = [0x4f, 0x53, 0x45, 0x31]; // "OSE1"
export const ENVELOPE_HEADER_BYTES = 9;
/** Header + 12-byte IV + 16-byte GCM tag. */
export const ENVELOPE_MIN_BYTES = ENVELOPE_HEADER_BYTES + 12 + 16;

/** The key epoch an `OSE1` envelope was sealed under, or throws. */
export function envelopeEpoch(bytes: Uint8Array, what: string): number {
  if (bytes.byteLength < ENVELOPE_MIN_BYTES) {
    throw badRequest(`${what} is not an OSE1 envelope`);
  }
  for (let i = 0; i < 4; i++) {
    if (bytes[i] !== ENVELOPE_MAGIC[i]) {
      throw badRequest(`${what} is not an OSE1 envelope`);
    }
  }
  if (bytes[4] !== 1) throw badRequest(`${what} has an unknown envelope version`);
  return (
    ((bytes[5]! << 24) | (bytes[6]! << 16) | (bytes[7]! << 8) | bytes[8]!) >>> 0
  );
}

/** Enforce that a ciphertext was sealed under the namespace's current epoch. */
export function requireEpoch(bytes: Uint8Array, epoch: number, what: string): void {
  const got = envelopeEpoch(bytes, what);
  if (got !== epoch) {
    throw badRequest(`${what} is sealed under epoch ${got}; current is ${epoch}`, {
      reason: "stale_epoch",
      epoch,
    });
  }
}
