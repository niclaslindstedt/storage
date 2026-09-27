// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Just enough ASN.1 DER to build X.509 certificates and PKCS#10 requests
// (and to read them back in tests). Node can sign and verify but cannot
// build a certificate, and the server takes no runtime dependencies.

export type Der = Uint8Array;

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function length(n: number): Uint8Array {
  if (n < 0x80) return Uint8Array.of(n);
  const bytes: number[] = [];
  while (n > 0) {
    bytes.unshift(n & 0xff);
    n >>>= 8;
  }
  return Uint8Array.of(0x80 | bytes.length, ...bytes);
}

export function tlv(tag: number, ...content: Uint8Array[]): Der {
  const body = concat(content);
  return concat([Uint8Array.of(tag), length(body.length), body]);
}

export const seq = (...items: Der[]) => tlv(0x30, ...items);
export const set = (...items: Der[]) => tlv(0x31, ...items);
export const nul = () => Uint8Array.of(0x05, 0x00);
export const bool = (v: boolean) => tlv(0x01, Uint8Array.of(v ? 0xff : 0x00));
export const octets = (b: Uint8Array) => tlv(0x04, b);
export const utf8 = (s: string) => tlv(0x0c, new TextEncoder().encode(s));
export const ia5 = (s: string) => tlv(0x16, new TextEncoder().encode(s));
/** BIT STRING with no unused bits. */
export const bits = (b: Uint8Array) => tlv(0x03, Uint8Array.of(0), b);
/** Context-specific constructed (EXPLICIT) tag [n]. */
export const explicit = (n: number, inner: Der) => tlv(0xa0 | n, inner);
/** Context-specific primitive (IMPLICIT) tag [n]. */
export const implicit = (n: number, content: Uint8Array) =>
  tlv(0x80 | n, content);

/** INTEGER from unsigned big-endian bytes (a 0x00 is prepended if needed). */
export function uint(bytes: Uint8Array): Der {
  let i = 0;
  while (i < bytes.length - 1 && bytes[i] === 0) i++;
  let b = bytes.slice(i);
  if (b[0]! & 0x80) b = concat([Uint8Array.of(0), b]);
  return tlv(0x02, b);
}

export const int = (n: number) => uint(Uint8Array.of(...toBytes(n)));

function toBytes(n: number): number[] {
  const out: number[] = [];
  do {
    out.unshift(n & 0xff);
    n = Math.floor(n / 256);
  } while (n > 0);
  return out;
}

export function oid(dotted: string): Der {
  const arcs = dotted.split(".").map(Number);
  const out: number[] = [arcs[0]! * 40 + arcs[1]!];
  for (const arc of arcs.slice(2)) {
    const stack: number[] = [arc & 0x7f];
    let v = Math.floor(arc / 128);
    while (v > 0) {
      stack.unshift((v & 0x7f) | 0x80);
      v = Math.floor(v / 128);
    }
    out.push(...stack);
  }
  return tlv(0x06, Uint8Array.from(out));
}

/** UTCTime before 2050, GeneralizedTime after (RFC 5280 §4.1.2.5). */
export function time(date: Date): Der {
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  const y = date.getUTCFullYear();
  const rest =
    pad(date.getUTCMonth() + 1) +
    pad(date.getUTCDate()) +
    pad(date.getUTCHours()) +
    pad(date.getUTCMinutes()) +
    pad(date.getUTCSeconds()) +
    "Z";
  return y < 2050
    ? tlv(0x17, new TextEncoder().encode(pad(y % 100) + rest))
    : tlv(0x18, new TextEncoder().encode(pad(y, 4) + rest));
}

export { concat };

// ---- reading ------------------------------------------------------------------

export type Node = {
  tag: number;
  header: number;
  start: number;
  end: number;
  bytes: Uint8Array;
};

/** Parse one TLV at `offset`. */
export function read(buf: Uint8Array, offset = 0): Node {
  const tag = buf[offset]!;
  let len = buf[offset + 1]!;
  let header = 2;
  if (len & 0x80) {
    const n = len & 0x7f;
    len = 0;
    for (let i = 0; i < n; i++) len = len * 256 + buf[offset + 2 + i]!;
    header += n;
  }
  const start = offset + header;
  return {
    tag,
    header,
    start,
    end: start + len,
    bytes: buf.subarray(offset, start + len),
  };
}

/** The children of a constructed node. */
export function children(buf: Uint8Array, node: Node): Node[] {
  const out: Node[] = [];
  for (let o = node.start; o < node.end;) {
    const c = read(buf, o);
    out.push(c);
    o = c.end;
  }
  return out;
}

export function content(buf: Uint8Array, node: Node): Uint8Array {
  return buf.subarray(node.start, node.end);
}
