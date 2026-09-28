// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// What reaches the model from the server is data, never instructions. File
// contents, file and folder names, device and account names, log lines —
// anyone who can write to a shared folder, name a device or trigger a log
// line chooses those bytes, and a model reading them can be steered by them
// (prompt injection). So:
//
// - short strings (names) lose control, bidi-override and zero-width
//   characters and are cut to a sane length, so they cannot hide text,
//   reorder it on screen or smuggle terminal escapes;
// - long content is wrapped in a fence with a random, per-result boundary
//   the content cannot know in advance, and the server's instructions tell
//   the model that fenced text is data;
// - every result is size-capped.

import { randomBytes } from "node:crypto";

// C0/C1 controls (except tab and newline), bidi embeddings, overrides and
// isolates, zero-width and invisible formatting characters, variation
// selectors, BOM. Built from code points so the source holds no invisible
// characters itself.
const INVISIBLE_RANGES: [number, number][] = [
  [0x00, 0x08],
  [0x0b, 0x1f],
  [0x7f, 0x9f],
  [0xad, 0xad],
  [0x61c, 0x61c],
  [0x115f, 0x1160],
  [0x17b4, 0x17b5],
  [0x180e, 0x180e],
  [0x200b, 0x200f],
  [0x202a, 0x202e],
  [0x2060, 0x206f],
  [0x3164, 0x3164],
  [0xfe00, 0xfe0f],
  [0xfeff, 0xfeff],
  [0xffa0, 0xffa0],
  [0xfff9, 0xfffb],
  [0xe0000, 0xe007f],
];

function invisible(cp: number): boolean {
  return INVISIBLE_RANGES.some(([lo, hi]) => cp >= lo && cp <= hi);
}

function strip(s: string): string {
  let out = "";
  for (const ch of s) if (!invisible(ch.codePointAt(0)!)) out += ch;
  return out;
}

/** A name for display: one line, visible characters only, bounded. */
export function cleanName(value: unknown, max = 200): string {
  const chars = [...strip(String(value ?? "").replace(/[\r\n\t]+/g, " "))];
  return chars.length > max
    ? `${chars.slice(0, max).join("")}…`
    : chars.join("");
}

/** Multi-line text with invisible characters removed (tabs and newlines kept). */
export function cleanText(value: string): string {
  // Tab (0x09) and newline (0x0a) are outside the stripped ranges.
  return strip(value.replace(/\r\n?/g, "\n"));
}

/** Clean every string in a JSON-like value (for structured results). */
export function cleanDeep<T>(value: T): T {
  // Values keep their line breaks (a row may hold a note): inside JSON they
  // are escaped, so they cannot break the output's structure. Size is
  // bounded where results are built (see `json`).
  if (typeof value === "string") return cleanText(value) as T;
  if (Array.isArray(value)) return value.map((v) => cleanDeep(v)) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = cleanDeep(v);
    return out as T;
  }
  return value;
}

/**
 * Wrap untrusted content in a fence. The boundary is random per call, so
 * content cannot close the fence early and speak as the tool.
 */
export function fence(kind: string, label: string, body: string): string {
  const tag = randomBytes(6).toString("hex");
  return [
    `<untrusted-${kind} id="${tag}" source="${cleanName(label, 300).replace(/"/g, "'")}">`,
    body,
    `</untrusted-${kind} id="${tag}">`,
  ].join("\n");
}

/** Cut text to at most `maxBytes` of UTF-8, on a character boundary. */
export function capText(
  text: string,
  maxBytes: number,
): { text: string; truncated: boolean } {
  const bytes = Buffer.from(text, "utf8");
  if (bytes.byteLength <= maxBytes) return { text, truncated: false };
  let cut = maxBytes;
  // Step back over UTF-8 continuation bytes.
  while (cut > 0 && (bytes[cut]! & 0xc0) === 0x80) cut--;
  return { text: bytes.subarray(0, cut).toString("utf8"), truncated: true };
}

/** Whether bytes look like UTF-8 text (no NULs, decodes cleanly). */
export function isText(bytes: Uint8Array): boolean {
  if (bytes.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KiB", "MiB", "GiB", "TiB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
}
