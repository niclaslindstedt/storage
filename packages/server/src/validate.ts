// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Input validation. Every value that crosses the API boundary is checked for
// type, length and charset here before a service sees it. The server cannot
// read encrypted names, but it can insist they are well-formed opaque tokens,
// which rules out path traversal and control characters by construction.

import { badRequest } from "./errors.ts";
import { fromB64u } from "./util/b64.ts";

const SEGMENT = /^[A-Za-z0-9._~-]{1,512}$/;
const APP = /^[a-z0-9][a-z0-9.-]{0,63}$/;
const B64U = /^[A-Za-z0-9_-]+$/;
const ID = /^[a-z]{2,5}_[A-Za-z0-9_-]{22}$/;

export const MAX_PATH_LENGTH = 4096;
export const MAX_PATH_DEPTH = 32;

export type Json = Record<string, unknown>;

export function asObject(value: unknown, what = "body"): Json {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw badRequest(`${what} must be a JSON object`);
  }
  return value as Json;
}

export function str(
  obj: Json,
  key: string,
  opts: { max?: number; min?: number; pattern?: RegExp; optional?: boolean } = {},
): string {
  const v = obj[key];
  if (v === undefined || v === null) {
    if (opts.optional) return undefined as unknown as string;
    throw badRequest(`${key} is required`);
  }
  if (typeof v !== "string") throw badRequest(`${key} must be a string`);
  if (v.length < (opts.min ?? 1)) throw badRequest(`${key} is too short`);
  if (v.length > (opts.max ?? 1024)) throw badRequest(`${key} is too long`);
  if (opts.pattern && !opts.pattern.test(v)) {
    throw badRequest(`${key} is malformed`);
  }
  return v;
}

export function optStr(
  obj: Json,
  key: string,
  opts: { max?: number; min?: number; pattern?: RegExp } = {},
): string | undefined {
  return obj[key] === undefined || obj[key] === null
    ? undefined
    : str(obj, key, opts);
}

export function int(
  obj: Json,
  key: string,
  opts: { min?: number; max?: number; optional?: boolean } = {},
): number {
  const v = obj[key];
  if (v === undefined || v === null) {
    if (opts.optional) return undefined as unknown as number;
    throw badRequest(`${key} is required`);
  }
  if (typeof v !== "number" || !Number.isSafeInteger(v)) {
    throw badRequest(`${key} must be an integer`);
  }
  if (opts.min !== undefined && v < opts.min) throw badRequest(`${key} too small`);
  if (opts.max !== undefined && v > opts.max) throw badRequest(`${key} too large`);
  return v;
}

export function bool(obj: Json, key: string, fallback: boolean): boolean {
  const v = obj[key];
  if (v === undefined || v === null) return fallback;
  if (typeof v !== "boolean") throw badRequest(`${key} must be a boolean`);
  return v;
}

export function oneOf<T extends string>(
  obj: Json,
  key: string,
  values: readonly T[],
  fallback?: T,
): T {
  const v = obj[key];
  if ((v === undefined || v === null) && fallback !== undefined) return fallback;
  if (typeof v !== "string" || !values.includes(v as T)) {
    throw badRequest(`${key} must be one of ${values.join(", ")}`);
  }
  return v as T;
}

/** A base64url string (opaque ciphertext / key material) of bounded size. */
export function b64u(obj: Json, key: string, maxBytes: number): string {
  const v = str(obj, key, { max: Math.ceil((maxBytes * 4) / 3) + 4 });
  checkB64u(v, key);
  return v;
}

export function optB64u(obj: Json, key: string, maxBytes: number): string | undefined {
  return obj[key] === undefined || obj[key] === null ? undefined : b64u(obj, key, maxBytes);
}

export function checkB64u(v: string, what: string): Uint8Array {
  if (!B64U.test(v)) throw badRequest(`${what} must be base64url`);
  try {
    return fromB64u(v);
  } catch {
    throw badRequest(`${what} must be base64url`);
  }
}

export function checkId(v: string, what: string): string {
  if (!ID.test(v)) throw badRequest(`${what} is malformed`);
  return v;
}

export function checkApp(v: string): string {
  if (!APP.test(v)) throw badRequest("app must match [a-z0-9][a-z0-9.-]{0,63}");
  return v;
}

/** An opaque (encrypted) name: collection, record key, or one path segment. */
export function checkSegment(v: string, what: string): string {
  if (!SEGMENT.test(v) || v === "." || v === "..") {
    throw badRequest(`${what} is malformed`);
  }
  return v;
}

/** A `/`-joined list of opaque segments. The empty string is the root. */
export function checkPath(v: string, what = "path", allowRoot = false): string {
  if (v === "" && allowRoot) return v;
  if (v.length > MAX_PATH_LENGTH) throw badRequest(`${what} is too long`);
  const parts = v.split("/");
  if (parts.length > MAX_PATH_DEPTH) throw badRequest(`${what} is too deep`);
  for (const p of parts) checkSegment(p, what);
  return v;
}

/** A JSON object whose values are validated by `each`. */
export function record<T>(
  obj: Json,
  key: string,
  each: (value: unknown, key: string) => T,
  maxEntries = 1000,
): Record<string, T> {
  const v = asObject(obj[key], key);
  const entries = Object.entries(v);
  if (entries.length > maxEntries) throw badRequest(`${key} has too many entries`);
  const out: Record<string, T> = {};
  for (const [k, val] of entries) out[k] = each(val, k);
  return out;
}
