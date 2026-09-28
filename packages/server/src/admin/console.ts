// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The admin console listener (SPEC §11.1): a separate HTTP server, loopback
// by default, that serves the console UI and its JSON API. Every request
// passes the DNS-rebinding guard; the API needs the admin token (bearer) or
// a session cookie obtained with it; cookie-authenticated writes need the
// CSRF header and a same-origin Origin. No CORS, strict CSP.

import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";

import { ApiError } from "../errors.ts";
import {
  type ApiResult,
  type ConsoleApi,
  createConsoleApi,
  LOCAL_ACTOR,
} from "./api.ts";
import { isLoopback } from "./checks.ts";
import type { ConsoleDeps } from "./deps.ts";
import { AdminAuth, hostAllowed } from "./session.ts";
import ui from "./ui/main.ts?bundle";

export type { ConsoleDeps } from "./deps.ts";

export type AdminConsole = {
  server: Server;
  /** Base URL, e.g. `http://127.0.0.1:8081`. */
  url: string;
  auth: AdminAuth;
  /** A sign-in link carrying the current token (print it, never log it). */
  loginUrl(): string;
  close(): Promise<void>;
};

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "base-uri 'none'",
].join("; ");

const FAVICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect x="3" y="5" width="26" height="8" rx="3" fill="#3355ff"/><rect x="3" y="15" width="26" height="8" rx="3" fill="#3355ff" opacity=".6"/><path d="M13 26h6v3h-6z" fill="#3355ff" opacity=".6"/></svg>`;

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function shell(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="referrer" content="no-referrer">
<title>${esc(title)}</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/app.css">
</head>
<body>${body}</body>
</html>`;
}

function loginPage(name: string, message?: string): string {
  return shell(
    `Sign in — ${name}`,
    `<main class="login">
<h1>${esc(name)} <span class="muted">admin console</span></h1>
${message ? `<p class="alert" role="alert">${esc(message)}</p>` : ""}
<form method="post" action="/login">
<label for="token">Admin token</label>
<input id="token" name="token" type="password" autocomplete="off" required spellcheck="false">
<button type="submit">Sign in</button>
</form>
<p class="muted">Get a sign-in link on the server with <code>storage-server admin</code>,
or read the token from <code>admin.token</code> in the data directory.</p>
</main>`,
  );
}

const APP = (name: string) =>
  shell(
    `${name} — storage admin`,
    `<div id="app" data-name="${esc(name)}"><noscript>The admin console needs JavaScript.</noscript></div>
<script src="/app.js" defer></script>`,
  );

async function readBody(req: IncomingMessage, limit: number): Promise<string> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > limit)
      throw new ApiError(413, "too_large", "request body is too large");
    chunks.push(c as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function startAdminConsole(
  deps: ConsoleDeps,
  listen: { host: string; port: number },
  api: ConsoleApi = createConsoleApi(deps),
): Promise<AdminConsole> {
  const { ctx } = deps;
  const auth = new AdminAuth({ dataDir: ctx.config.dataDir, clock: ctx.clock });
  const { state, routes } = api;
  let baseUrl = "";

  const send = (
    res: ServerResponse,
    status: number,
    body: string,
    type = "text/html; charset=utf-8",
    headers: Record<string, string> = {},
  ) => {
    res.writeHead(status, {
      "Content-Type": type,
      "Content-Length": Buffer.byteLength(body),
      ...headers,
    });
    res.end(body);
  };
  const redirect = (
    res: ServerResponse,
    to: string,
    headers: Record<string, string> = {},
  ) => res.writeHead(303, { Location: to, ...headers }).end();
  const sendJson = (res: ServerResponse, status: number, value: unknown) =>
    send(res, status, JSON.stringify(value), "application/json; charset=utf-8");

  function client(req: IncomingMessage): string {
    return req.socket.remoteAddress ?? "unknown";
  }

  function login(req: IncomingMessage, res: ServerResponse, token: string) {
    const ip = client(req);
    if (!auth.allowLogin(ip))
      return send(
        res,
        429,
        loginPage(ctx.config.name, "Too many attempts. Wait a minute."),
      );
    if (!auth.checkToken(token)) {
      ctx.audit.append({
        actor: "admin-console",
        action: "admin.login-failed",
        ip,
      });
      return send(
        res,
        403,
        loginPage(ctx.config.name, "That token is not valid."),
      );
    }
    const s = auth.createSession();
    ctx.audit.append({ actor: "admin-console", action: "admin.login", ip });
    redirect(res, "/", { "Set-Cookie": s.cookie });
  }

  /** Same-origin check for cookie-authenticated writes (CSRF). */
  function sameOrigin(req: IncomingMessage): boolean {
    const origin = req.headers.origin;
    return !origin || origin === `http://${req.headers.host}`;
  }

  async function handle(req: IncomingMessage, res: ServerResponse) {
    res.setHeader("Content-Security-Policy", CSP);
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("Cross-Origin-Resource-Policy", "same-origin");

    if (!hostAllowed(req.headers.host))
      return send(res, 421, "Misdirected request", "text/plain; charset=utf-8");

    const url = new URL(req.url ?? "/", "http://console");
    const path = url.pathname;
    const method = req.method ?? "GET";

    // Public: static assets and the login flow.
    if (method === "GET" && path === "/app.js")
      return send(res, 200, ui.js, "text/javascript; charset=utf-8");
    if (method === "GET" && path === "/app.css")
      return send(res, 200, ui.css, "text/css; charset=utf-8");
    if (method === "GET" && path === "/favicon.svg")
      return send(res, 200, FAVICON, "image/svg+xml");
    if (path === "/login") {
      if (method === "GET") {
        const token = url.searchParams.get("token");
        if (token !== null) return login(req, res, token);
        return send(res, 200, loginPage(ctx.config.name));
      }
      if (method === "POST") {
        const form = new URLSearchParams(await readBody(req, 4096));
        return login(req, res, form.get("token") ?? "");
      }
    }

    const cookie = req.headers.cookie;
    const authz = req.headers.authorization;
    const bearer =
      typeof authz === "string" && authz.startsWith("Bearer ")
        ? authz.slice(7).trim()
        : null;
    const viaBearer = bearer !== null && auth.checkToken(bearer);
    const viaCookie = !viaBearer && auth.session(cookie);

    if (path === "/logout" && method === "POST") {
      if (viaCookie && sameOrigin(req)) auth.destroy(cookie);
      return redirect(res, "/login", { "Set-Cookie": AdminAuth.clearCookie() });
    }
    if (method === "GET" && path === "/") {
      if (!viaCookie && !viaBearer) return redirect(res, "/login");
      return send(res, 200, APP(ctx.config.name));
    }

    const isApi = path.startsWith("/api/") || path === "/metrics";
    if (!isApi) return send(res, 404, "Not found", "text/plain; charset=utf-8");
    if (!viaBearer && !viaCookie)
      return sendJson(res, 401, {
        error: { code: "unauthenticated", message: "sign in first" },
      });
    const mutating = !["GET", "HEAD"].includes(method);
    if (
      mutating &&
      viaCookie &&
      (req.headers["x-storage-admin"] !== "1" || !sameOrigin(req))
    )
      return sendJson(res, 403, {
        error: { code: "csrf", message: "missing X-Storage-Admin header" },
      });

    const matched = routes.match(method, path);
    if (!matched)
      return sendJson(res, 404, {
        error: { code: "not_found", message: "no such endpoint" },
      });
    if ("methods" in matched)
      return sendJson(res, 405, {
        error: { code: "method_not_allowed", message: "method not allowed" },
      });

    let parsed: Record<string, unknown> | undefined;
    const out: ApiResult = await matched.handler({
      params: matched.params,
      query: url.searchParams,
      ip: client(req),
      actor: LOCAL_ACTOR,
      remote: false,
      async body() {
        if (parsed) return parsed;
        const text = await readBody(req, 64 * 1024);
        if (!text) return (parsed = {});
        try {
          const v = JSON.parse(text) as unknown;
          if (!v || typeof v !== "object" || Array.isArray(v)) throw 0;
          return (parsed = v as Record<string, unknown>);
        } catch {
          throw new ApiError(400, "bad_request", "body must be a JSON object");
        }
      },
    });

    // A change can alter a check's verdict (e.g. the first admin account).
    if (mutating && (out.status ?? 200) < 400) void state.refreshChecks?.();

    if (out.sse) {
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        Connection: "keep-alive",
      });
      res.write("retry: 3000\n\n");
      const ping = setInterval(() => res.write(": ping\n\n"), 25_000);
      const stop = out.sse((event, data) =>
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
      );
      res.on("close", () => {
        clearInterval(ping);
        stop();
      });
      return;
    }
    if (out.stream) {
      res.writeHead(out.status ?? 200, {
        "Content-Type": out.type ?? "application/octet-stream",
        ...out.headers,
      });
      out.stream.pipe(res);
      return;
    }
    if (out.text !== undefined)
      return send(
        res,
        out.status ?? 200,
        out.text,
        out.type ?? "text/plain; charset=utf-8",
        out.headers,
      );
    const body = JSON.stringify(out.json ?? {});
    send(
      res,
      out.status ?? 200,
      body,
      "application/json; charset=utf-8",
      out.headers,
    );
  }

  const server = createServer(
    { requestTimeout: 60_000, headersTimeout: 20_000 },
    (req, res) => {
      handle(req, res).catch((err: unknown) => {
        if (res.headersSent) return void res.destroy();
        if (err instanceof ApiError)
          return sendJson(res, err.status, {
            error: { code: err.code, message: err.message, ...err.details },
          });
        ctx.log.error("admin console request failed", err);
        sendJson(res, 500, {
          error: { code: "internal", message: "internal error" },
        });
      });
    },
  );

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(listen.port, listen.host, () => resolve());
  });
  const port = (server.address() as AddressInfo).port;
  const host =
    listen.host === "0.0.0.0" || listen.host === "::"
      ? "127.0.0.1"
      : listen.host.includes(":")
        ? `[${listen.host}]`
        : listen.host;
  baseUrl = `http://${host}:${port}`;
  if (!isLoopback(listen.host))
    ctx.log.warn(
      `admin console listens on ${listen.host}:${port} over plain HTTP — publish it only on a host's loopback (docker -p 127.0.0.1:${port}:${port}) or use an SSH tunnel`,
    );
  state.refreshChecks?.();

  return {
    server,
    url: baseUrl,
    auth,
    loginUrl: () => `${baseUrl}/login?token=${auth.token()}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}
