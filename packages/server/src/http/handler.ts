// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The request lifecycle: security headers → CORS → (test faults) → routing →
// authentication → rate limiting → body limits → handler → error rendering.
// Every response carries strict security headers; errors never leak
// internals (a 500 says only "internal error" and is logged server-side).

import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";

import type { Metrics } from "../admin/metrics.ts";
import type { Ctx } from "../context.ts";
import {
  ApiError,
  badRequest,
  rateLimited,
  tooLarge,
  unauthenticated,
} from "../errors.ts";
import { authenticate } from "../services/auth.ts";
import { enforceRouteScope } from "../services/scope.ts";
import { RateLimiter } from "./rate-limit.ts";
import type { Req, Res, Router, SseWriter } from "./router.ts";

export type FaultRule = {
  match: { method?: string; path?: string };
  action: "offline" | "status" | "delay";
  status?: number;
  retryAfter?: number;
  delayMs?: number;
  /** Remaining times this rule fires; undefined = forever. */
  times?: number;
};

export type HandlerOptions = {
  /** TLS is terminated by this server (enables HSTS). */
  secure: boolean;
  /** Test-mode fault rules, consulted before routing (never for /__test/). */
  faults?: FaultRule[];
  /** Request metrics for the admin console (route pattern, status, time). */
  metrics?: Metrics;
};

const EXPOSED = "ETag, X-File-Id, X-Meta, X-Seq, Retry-After, Content-Length";
const ALLOWED_HEADERS =
  "Authorization, Content-Type, If-Match, If-None-Match, X-Meta, X-Test-Secret";
const METHODS = "GET, HEAD, PUT, POST, PATCH, DELETE";

export function createHandler(ctx: Ctx, router: Router, opts: HandlerOptions) {
  const publicLimiter = new RateLimiter(
    ctx.clock,
    ctx.config.rateLimit.publicPerMinute,
  );
  const deviceLimiter = new RateLimiter(
    ctx.clock,
    ctx.config.rateLimit.devicePerMinute,
  );

  function clientIp(req: IncomingMessage): string | null {
    if (ctx.config.trustProxy) {
      const fwd = req.headers["x-forwarded-for"];
      const first = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(",")[0]?.trim();
      if (first) return first;
    }
    return req.socket.remoteAddress ?? null;
  }

  function originAllowed(origin: string, isPublic: boolean): boolean {
    if (ctx.config.cors.mode === "any" || isPublic) return true;
    if (ctx.config.cors.origins.includes(origin)) return true;
    return Boolean(
      ctx.db.get("SELECT 1 FROM origins WHERE origin = ?", origin),
    );
  }

  function baseHeaders(res: ServerResponse): void {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'none'; frame-ancestors 'none'",
    );
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    if (opts.secure)
      res.setHeader(
        "Strict-Transport-Security",
        "max-age=63072000; includeSubDomains",
      );
  }

  function sendJson(
    res: ServerResponse,
    status: number,
    body: unknown,
    headers: Record<string, string> = {},
  ) {
    const text = JSON.stringify(body);
    res.writeHead(status, {
      ...headers,
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": Buffer.byteLength(text),
    });
    res.end(text);
  }

  function sendError(res: ServerResponse, err: unknown): void {
    if (res.headersSent) {
      res.destroy();
      return;
    }
    if (err instanceof ApiError) {
      sendJson(
        res,
        err.status,
        { error: { code: err.code, message: err.message, ...err.details } },
        err.headers,
      );
      return;
    }
    ctx.log.error("request failed", err);
    sendJson(res, 500, {
      error: { code: "internal", message: "internal error" },
    });
  }

  async function applyFault(
    req: IncomingMessage,
    res: ServerResponse,
    path: string,
  ): Promise<boolean> {
    const rules = opts.faults;
    if (!rules || rules.length === 0 || path.startsWith("/__test/"))
      return false;
    const rule = rules.find(
      (r) =>
        (!r.match.method || r.match.method === req.method) &&
        (!r.match.path || path.startsWith(r.match.path)),
    );
    if (!rule) return false;
    if (rule.times !== undefined) {
      rule.times--;
      if (rule.times <= 0) rules.splice(rules.indexOf(rule), 1);
    }
    if (rule.action === "offline") {
      req.socket.destroy();
      return true;
    }
    if (rule.action === "delay") {
      await new Promise((r) => setTimeout(r, rule.delayMs ?? 1000));
      return false;
    }
    const status = rule.status ?? 503;
    const headers: Record<string, string> = {};
    if (rule.retryAfter !== undefined)
      headers["Retry-After"] = String(rule.retryAfter);
    sendJson(
      res,
      status,
      {
        error: {
          code: status === 429 ? "rate_limited" : "fault",
          message: "injected fault",
        },
      },
      headers,
    );
    return true;
  }

  return async function handle(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    baseHeaders(res);
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname;
    const method = req.method ?? "GET";
    const origin =
      typeof req.headers.origin === "string" ? req.headers.origin : null;
    const ip = clientIp(req);
    const abort = new AbortController();
    res.on("close", () => abort.abort());

    // Metrics: the route *pattern* only, recorded once the response ends.
    let routeLabel = method === "OPTIONS" ? "(preflight)" : "(unmatched)";
    let streaming = Number(url.searchParams.get("wait") ?? "0") > 0;
    if (opts.metrics) {
      const metrics = opts.metrics;
      const started = performance.now();
      res.once("close", () =>
        metrics.record({
          method,
          route: routeLabel,
          status: res.statusCode,
          ms: Math.round((performance.now() - started) * 10) / 10,
          streaming,
        }),
      );
    }

    try {
      const found = router.match(method === "OPTIONS" ? "GET" : method, path);
      const anyPublic = router
        .routesForPath(path)
        .some((r) => r.auth !== "required");

      if (origin) {
        const isPublic =
          found && "route" in found
            ? found.route.auth !== "required"
            : anyPublic;
        if (originAllowed(origin, isPublic || anyPublic)) {
          res.setHeader("Access-Control-Allow-Origin", origin);
          res.setHeader("Access-Control-Expose-Headers", EXPOSED);
          res.setHeader("Vary", "Origin");
        }
      }
      if (method === "OPTIONS") {
        if (res.hasHeader("Access-Control-Allow-Origin")) {
          res.setHeader("Access-Control-Allow-Methods", METHODS);
          res.setHeader("Access-Control-Allow-Headers", ALLOWED_HEADERS);
          res.setHeader("Access-Control-Max-Age", "600");
          if (
            req.headers["access-control-request-private-network"] === "true"
          ) {
            res.setHeader("Access-Control-Allow-Private-Network", "true");
          }
        }
        res.writeHead(204).end();
        return;
      }

      if (await applyFault(req, res, path)) return;

      const matched = router.match(method, path);
      if (!matched) {
        sendJson(res, 404, {
          error: { code: "not_found", message: "no such endpoint" },
        });
        return;
      }
      if (!("route" in matched)) {
        sendJson(
          res,
          405,
          {
            error: {
              code: "method_not_allowed",
              message: "method not allowed",
            },
          },
          {
            Allow: matched.methods.join(", "),
          },
        );
        return;
      }
      const { route, params } = matched;
      routeLabel = route.pattern;

      const authz = req.headers.authorization;
      const token =
        typeof authz === "string" && authz.startsWith("Bearer ")
          ? authz.slice(7).trim()
          : null;
      const principal =
        token && route.auth !== "none" ? authenticate(ctx, token) : null;
      if (route.auth === "required" && !principal) throw unauthenticated();
      // Agent devices (SPEC §11.4): the scope is checked before any handler.
      if (principal)
        enforceRouteScope(principal, route.method, route.pattern, params);

      if (route.rate !== "none") {
        const key = principal
          ? `d:${principal.deviceId}`
          : `ip:${ip ?? "unknown"}`;
        const wait = (
          principal && route.rate === "device" ? deviceLimiter : publicLimiter
        ).take(key);
        if (wait > 0) throw rateLimited(wait);
      }

      let consumed = false;
      const readBody = async (limit: number): Promise<Uint8Array> => {
        if (consumed) throw new Error("body already read");
        consumed = true;
        const declared = Number(req.headers["content-length"] ?? "0");
        if (declared > limit) throw tooLarge("request body is too large");
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of req) {
          size += (chunk as Buffer).length;
          if (size > limit) throw tooLarge("request body is too large");
          chunks.push(chunk as Buffer);
        }
        return new Uint8Array(Buffer.concat(chunks));
      };

      const r: Req = {
        method,
        path,
        params,
        query: url.searchParams,
        headers: req.headers,
        ip,
        origin,
        principal,
        token,
        raw: req,
        signal: abort.signal,
        async json() {
          const type = String(req.headers["content-type"] ?? "");
          const body = await readBody(
            Math.min(ctx.config.limits.maxBodyBytes, 8 * 1024 * 1024),
          );
          if (body.byteLength === 0) return {};
          if (!type.startsWith("application/json"))
            throw badRequest("Content-Type must be application/json");
          let parsed: unknown;
          try {
            parsed = JSON.parse(Buffer.from(body).toString("utf8"));
          } catch {
            throw badRequest("malformed JSON");
          }
          if (
            typeof parsed !== "object" ||
            parsed === null ||
            Array.isArray(parsed)
          ) {
            throw badRequest("body must be a JSON object");
          }
          return parsed as Record<string, unknown>;
        },
        bytes(limit = ctx.config.limits.maxBodyBytes) {
          return readBody(limit);
        },
        auth() {
          if (!principal) throw unauthenticated();
          return principal;
        },
      };

      const out: Res = await route.handler(r);
      if (out.sse) {
        streaming = true;
        const metrics = opts.metrics;
        if (metrics) {
          metrics.sseOpened();
          res.once("close", () => metrics.sseClosed());
        }
        startSse(res, out.sse);
        return;
      }
      const status =
        out.status ??
        (out.json === undefined && out.body === undefined ? 204 : 200);
      if (out.body !== undefined) {
        res.writeHead(status, {
          "Content-Type": "application/octet-stream",
          ...out.headers,
        });
        if (method === "HEAD") {
          if (out.body instanceof Readable) out.body.destroy();
          res.end();
        } else if (out.body instanceof Readable) {
          out.body.on("error", (e) => {
            ctx.log.error("stream failed", e);
            res.destroy();
          });
          out.body.pipe(res);
        } else {
          res.end(out.body);
        }
        return;
      }
      if (out.json !== undefined) {
        sendJson(res, status, out.json, out.headers);
        return;
      }
      res.writeHead(status, out.headers ?? {}).end();
    } catch (err) {
      sendError(res, err);
    }
  };
}

function startSse(res: ServerResponse, run: NonNullable<Res["sse"]>): void {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Accel-Buffering": "no",
    Connection: "keep-alive",
  });
  res.write("retry: 3000\n\n");
  const closers: (() => void)[] = [];
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    for (const fn of closers.splice(0)) fn();
    res.end();
  };
  res.on("close", close);
  const writer: SseWriter = {
    send(event, data) {
      if (!closed)
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    },
    comment(text) {
      if (!closed) res.write(`: ${text}\n\n`);
    },
    close,
  };
  run(writer, (fn) => closers.push(fn));
}
