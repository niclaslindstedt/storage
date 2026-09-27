// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Helpers shared by the route modules.

import { badRequest } from "../errors.ts";
import type { Req } from "../http/router.ts";

export const etag = (rev: string) => `"${rev}"`;

/** The revision in an `If-Match` header (quotes and weak prefix stripped). */
export function ifMatch(req: Req): string | undefined {
  const h = req.headers["if-match"];
  if (typeof h !== "string" || h === "") return undefined;
  const v = h.replace(/^W\//, "").replace(/^"|"$/g, "");
  if (!/^\d{1,15}$/.test(v)) throw badRequest("If-Match must be a revision");
  return v;
}

export function ifNoneMatchAny(req: Req): boolean {
  return req.headers["if-none-match"] === "*";
}

export function header(req: Req, name: string): string | undefined {
  const v = req.headers[name];
  return typeof v === "string" ? v : undefined;
}

export function queryInt(req: Req, name: string): number | undefined {
  const v = req.query.get(name);
  if (v === null || v === "") return undefined;
  if (!/^\d{1,9}$/.test(v))
    throw badRequest(`${name} must be a non-negative integer`);
  return Number(v);
}

export function queryBool(req: Req, name: string): boolean {
  const v = req.query.get(name);
  return v === "1" || v === "true";
}

export function optString(
  body: Record<string, unknown>,
  key: string,
): string | undefined {
  const v = body[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string") throw badRequest(`${key} must be a string`);
  return v;
}
