// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// base64url without padding — the one text encoding for bytes on the wire.

const VALID = /^[A-Za-z0-9_-]*$/;

export function toB64u(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString(
    "base64url",
  );
}

/** Decode strictly: any character outside the alphabet, or an impossible
 *  length, throws rather than silently decoding a prefix. */
export function fromB64u(text: string): Uint8Array {
  if (!VALID.test(text) || text.length % 4 === 1) {
    throw new Error("invalid base64url");
  }
  return new Uint8Array(Buffer.from(text, "base64url"));
}

export function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}
