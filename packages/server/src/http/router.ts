// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// A minimal router: method + path pattern → handler. Patterns use `:name`
// for one segment and a trailing `*name` for the rest of the path. Kept
// dependency-free on purpose — the smaller the HTTP surface, the easier it is
// to audit.

import type { IncomingHttpHeaders, IncomingMessage } from "node:http";
import type { Readable } from "node:stream";

import type { Principal } from "../services/principal.ts";

export type AuthMode = "none" | "optional" | "required";
export type RateClass = "public" | "device" | "none";

export type Req = {
  method: string;
  path: string;
  params: Record<string, string>;
  query: URLSearchParams;
  headers: IncomingHttpHeaders;
  ip: string | null;
  origin: string | null;
  principal: Principal | null;
  token: string | null;
  raw: IncomingMessage;
  signal: AbortSignal;
  /** Parse a JSON body (object) within the body limit. */
  json(): Promise<Record<string, unknown>>;
  /** Read the raw body within `limit` bytes. */
  bytes(limit?: number): Promise<Uint8Array>;
  /** The principal, or throw 401. */
  auth(): Principal;
};

export type SseWriter = {
  send(event: string, data: unknown): void;
  comment(text: string): void;
  close(): void;
};

export type Res = {
  status?: number;
  headers?: Record<string, string>;
  json?: unknown;
  body?: Uint8Array | Readable;
  /** Keep the connection open as a Server-Sent Events stream. */
  sse?: (writer: SseWriter, onClose: (fn: () => void) => void) => void;
};

export type Handler = (req: Req) => Promise<Res> | Res;

export type Route = {
  method: string;
  pattern: string;
  handler: Handler;
  auth: AuthMode;
  rate: RateClass;
  parts: string[];
};

export class Router {
  readonly routes: Route[] = [];

  add(
    method: string,
    pattern: string,
    handler: Handler,
    opts: { auth?: AuthMode; rate?: RateClass } = {},
  ): this {
    this.routes.push({
      method,
      pattern,
      handler,
      auth: opts.auth ?? "required",
      rate: opts.rate ?? (opts.auth === "none" ? "public" : "device"),
      parts: pattern.split("/").filter(Boolean),
    });
    return this;
  }

  /** The matching route and params; `methods` lists allowed methods on a path match. */
  match(
    method: string,
    path: string,
  ):
    | { route: Route; params: Record<string, string> }
    | { methods: string[] }
    | null {
    const segs = path.split("/").filter(Boolean);
    const methods: string[] = [];
    for (const route of this.routes) {
      const params = matchParts(route.parts, segs);
      if (!params) continue;
      if (
        route.method === method ||
        (method === "HEAD" &&
          route.method === "GET" &&
          !this.hasHead(route.pattern))
      ) {
        return { route, params };
      }
      methods.push(route.method);
    }
    return methods.length > 0 ? { methods } : null;
  }

  /** Every route whose pattern matches `path`, whatever its method. */
  routesForPath(path: string): Route[] {
    const segs = path.split("/").filter(Boolean);
    return this.routes.filter((r) => matchParts(r.parts, segs) !== null);
  }

  private hasHead(pattern: string): boolean {
    return this.routes.some(
      (r) => r.method === "HEAD" && r.pattern === pattern,
    );
  }
}

function matchParts(
  parts: string[],
  segs: string[],
): Record<string, string> | null {
  const params: Record<string, string> = {};
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]!;
    if (p.startsWith("*")) {
      if (i >= segs.length) return null;
      params[p.slice(1)] = segs.slice(i).map(decode).join("/");
      return params;
    }
    const s = segs[i];
    if (s === undefined) return null;
    if (p.startsWith(":")) params[p.slice(1)] = decode(s);
    else if (p !== s) return null;
  }
  return parts.length === segs.length ? params : null;
}

function decode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return "\u0000"; // fails validation downstream
  }
}
