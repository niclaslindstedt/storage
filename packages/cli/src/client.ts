// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Which server to talk to and how, and the console API client itself.
//
// Credentials come from (first match wins): -c/--context; STORAGE_SESSION;
// STORAGE_TOKEN; STORAGE_CONTEXT; the saved context whose URL is
// STORAGE_URL; the current context; and — on the server's own machine — the
// admin.token in its data directory. Saved credentials are only ever sent
// to their own context's URL.
//
// Two transports reach one API (SPEC §11.1, §11.2): the console listener
// with the admin token as a bearer (`/api/…`, `/metrics`), or the device API
// as an admin device (`/v1/console/…`), signing in with the device key.

import { existsSync, readFileSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { join } from "node:path";

import { defaultDataDir } from "../../server/src/cli/paths.ts";
import { UsageError } from "./args.ts";
import {
  type ConfigFile,
  type ConfigStore,
  type Context,
  type Credentials,
  type TokenCache,
} from "./config.ts";
import { decodeSession, signChallenge } from "./device.ts";
import { type Env, secret } from "./env.ts";
import { type HttpResponse, NetworkError, open, send } from "./http.ts";
import { DEFAULT_CONSOLE_URL } from "./spec.ts";

export type Target = {
  /** Where the credentials came from, for `auth status` and errors. */
  source: string;
  /** The saved context, when they came from one. */
  context?: string;
  url: string;
  auth: Credentials;
  server?: string;
  account?: string;
};

/** The server answered with an error status. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Not logged in, or the server rejected the credentials (exit 4). */
export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

export function normalizeUrl(url: string): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new UsageError(`not a URL: ${url}`);
  }
  if (u.protocol !== "http:" && u.protocol !== "https:")
    throw new UsageError(`not an http(s) URL: ${url}`);
  return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, "")}`;
}

function fromContext(name: string, ctx: Context, fp?: string): Target {
  const auth =
    ctx.auth.type === "device" && fp ? { ...ctx.auth, fp } : ctx.auth;
  return {
    source: `context "${name}"`,
    context: name,
    url: ctx.url,
    auth,
    server: ctx.server,
    account: ctx.account,
  };
}

export type ResolveInput = {
  env: Env;
  cwd: string;
  store: ConfigStore;
  /** -c/--context */
  context?: string;
  platform?: NodeJS.Platform;
};

/** The target a command talks to, or null when there are no credentials. */
export function resolveTarget(input: ResolveInput): Target | null {
  const { env, cwd } = input;
  const config: ConfigFile = input.store.read();
  const fp = env.STORAGE_FINGERPRINT || undefined;
  const named = (name: string, how: string): Target => {
    const ctx = config.contexts[name];
    if (!ctx)
      throw new AuthError(
        `no context named "${name}" (${how}); run \`storage context ls\``,
      );
    return fromContext(name, ctx, fp);
  };
  if (input.context) return named(input.context, "--context");

  const envUrl = env.STORAGE_URL ? normalizeUrl(env.STORAGE_URL) : undefined;
  const session = secret(env, "STORAGE_SESSION", cwd);
  if (session) {
    let s;
    try {
      s = decodeSession(session);
    } catch (err) {
      throw new AuthError((err as Error).message);
    }
    return {
      source: "STORAGE_SESSION",
      url: envUrl ?? normalizeUrl(s.url),
      auth: {
        type: "device",
        serverId: s.serverId,
        deviceId: s.deviceId,
        key: s.key,
        fp: fp ?? s.fp,
      },
    };
  }
  const token = secret(env, "STORAGE_TOKEN", cwd);
  if (token)
    return {
      source: "STORAGE_TOKEN",
      url: envUrl ?? DEFAULT_CONSOLE_URL,
      auth: { type: "token", token },
    };
  if (env.STORAGE_CONTEXT) return named(env.STORAGE_CONTEXT, "STORAGE_CONTEXT");
  if (envUrl) {
    const match = Object.entries(config.contexts).find(
      ([, c]) => normalizeUrl(c.url) === envUrl,
    );
    if (!match)
      throw new AuthError(
        `not logged in to ${envUrl} (STORAGE_URL): run \`storage auth login\`, or set STORAGE_TOKEN or STORAGE_SESSION`,
      );
    return fromContext(match[0], match[1], fp);
  }
  if (config.current && config.contexts[config.current])
    return fromContext(config.current, config.contexts[config.current]!, fp);
  const names = Object.keys(config.contexts);
  if (names.length === 1)
    return fromContext(names[0]!, config.contexts[names[0]!]!, fp);
  if (names.length > 1)
    throw new AuthError(
      `several contexts and none is current: run \`storage context use <name>\` (${names.join(", ")})`,
    );

  // On the server's machine: whoever can read the data directory is an admin.
  const dataDir = defaultDataDir(env as NodeJS.ProcessEnv, input.platform);
  const file = join(dataDir, "admin.token");
  if (existsSync(file)) {
    try {
      const t = readFileSync(file, "utf8").trim();
      if (/^[A-Za-z0-9_-]{43}$/.test(t)) {
        const port = env.STORAGE_ADMIN_PORT || "8081";
        return {
          source: `admin.token in ${dataDir}`,
          url: `http://127.0.0.1:${port}`,
          auth: { type: "token", token: t },
        };
      }
    } catch {
      // Not readable by this user: fall through to "not logged in".
    }
  }
  return null;
}

export const NOT_LOGGED_IN =
  "not logged in: run `storage auth login` (or set STORAGE_TOKEN or STORAGE_SESSION; see `storage help auth`)";

// ---------------------------------------------------------------- client

const LOOPBACK = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\])$/i;

/** A console path in the form the local listener serves. */
export function consolePath(path: string): string {
  let p = path.trim();
  if (!p.startsWith("/")) p = `/${p}`;
  if (p === "/metrics" || p.startsWith("/api/")) return p;
  if (p === "/api") return "/api/overview";
  return `/api${p}`;
}

type ClientOptions = {
  /** Keeps admin-device access tokens between runs. */
  cache?: TokenCache;
  debug?: (line: string) => void;
  warn?: (line: string) => void;
  signal?: AbortSignal;
};

export class ConsoleClient {
  private accessToken: string | null = null;
  private warned = false;

  constructor(
    readonly target: Target,
    private readonly opts: ClientOptions = {},
  ) {}

  get remote(): boolean {
    return this.target.auth.type === "device";
  }

  /** Where a console path goes on this transport. */
  urlFor(path: string): string {
    const p = consolePath(path);
    const [pathname, query] = p.split(/\?(.*)/s, 2) as [string, string?];
    const base = this.target.url.replace(/\/+$/, "");
    const mapped = this.remote
      ? `/v1/console/${pathname === "/metrics" ? "prometheus" : pathname.slice(5)}`
      : pathname;
    return `${base}${mapped}${query ? `?${query}` : ""}`;
  }

  private fp(): string | undefined {
    return this.target.auth.type === "device" ? this.target.auth.fp : undefined;
  }

  private async raw(
    method: string,
    url: string,
    headers: Record<string, string>,
    body?: string,
  ): Promise<HttpResponse> {
    for (let attempt = 0; ; attempt++) {
      const res = await send({
        method,
        url,
        headers,
        body,
        fp: this.fp(),
        signal: this.opts.signal,
      });
      this.opts.debug?.(`${method} ${url} → ${res.status}`);
      // Rate limited: wait as told, twice at most, when the wait is short.
      const wait = Number(res.headers["retry-after"] ?? NaN);
      if (res.status !== 429 || attempt >= 2 || !(wait >= 0 && wait <= 10))
        return res;
      this.opts.debug?.(`rate limited; retrying in ${wait} s`);
      await new Promise((r) => setTimeout(r, Math.max(wait, 0.2) * 1000));
    }
  }

  /** The token cache key: one device on one server URL. */
  get cacheKey(): string {
    const a = this.target.auth;
    return a.type === "device" ? `${a.deviceId}@${this.target.url}` : "";
  }

  /** Sign in as the admin device: challenge, signature, access token. */
  async deviceToken(): Promise<string> {
    const auth = this.target.auth;
    if (auth.type !== "device") throw new Error("not an admin device");
    if (this.accessToken) return this.accessToken;
    const cached = this.opts.cache?.get(this.cacheKey);
    if (cached) return (this.accessToken = cached);
    const base = this.target.url.replace(/\/+$/, "");
    const post = (path: string, body: unknown) =>
      this.raw(
        "POST",
        base + path,
        { "Content-Type": "application/json" },
        JSON.stringify(body),
      ).then((r) => {
        const data = parseJson(r.body);
        if (r.status === 401)
          throw new AuthError(
            `the server rejected this admin device (${errorMessage(data, r.status)}): it was revoked or its account disabled — log in again (${this.target.source})`,
          );
        if (r.status >= 400) throw apiError(r.status, data);
        return data as Record<string, string>;
      });
    const { challenge } = await post("/v1/auth/challenge", {
      deviceId: auth.deviceId,
    });
    const { token, expiresAt } = (await post("/v1/auth/token", {
      deviceId: auth.deviceId,
      challenge: challenge!,
      signature: signChallenge(auth, challenge!),
    })) as unknown as { token: string; expiresAt: number };
    this.opts.cache?.set(this.cacheKey, token, expiresAt);
    this.accessToken = token;
    return token;
  }

  /** Forget the access token (it was rejected, or the device logged out). */
  dropToken(): void {
    this.accessToken = null;
    this.opts.cache?.delete(this.cacheKey);
  }

  private async authHeader(): Promise<string> {
    if (this.target.auth.type === "token") {
      const u = new URL(this.target.url);
      if (
        u.protocol === "http:" &&
        !LOOPBACK.test(u.hostname) &&
        !this.warned
      ) {
        this.warned = true;
        this.opts.warn?.(
          `warning: sending the admin token over plain HTTP to ${u.host}; reach the console through an SSH tunnel (ssh -L 8081:127.0.0.1:8081 <server>) instead`,
        );
      }
      return `Bearer ${this.target.auth.token}`;
    }
    return `Bearer ${await this.deviceToken()}`;
  }

  /** Any request; error statuses are returned, not thrown (for `api`). */
  async request(
    method: string,
    path: string,
    body?: unknown,
    accept = "application/json",
  ): Promise<HttpResponse> {
    const headers: Record<string, string> = {
      Authorization: await this.authHeader(),
      Accept: accept,
    };
    let payload: string | undefined;
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      payload = typeof body === "string" ? body : JSON.stringify(body);
    }
    const url = this.urlFor(path);
    try {
      let res = await this.raw(method, url, headers, payload);
      // A device token lives 10 minutes: sign in again once if it lapsed.
      if (res.status === 401 && this.remote && this.accessToken) {
        this.dropToken();
        headers.Authorization = await this.authHeader();
        res = await this.raw(method, url, headers, payload);
      }
      return res;
    } catch (err) {
      throw explainNetwork(err, this.target);
    }
  }

  /** A request whose answer must succeed; throws ApiError / AuthError. */
  async call(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<HttpResponse> {
    const res = await this.request(method, path, body);
    if (res.status < 400) return res;
    const data = parseJson(res.body);
    if (res.status === 401)
      throw new AuthError(
        this.remote
          ? `the server rejected this admin device (${this.target.source}): log in again`
          : `the admin token was rejected (${this.target.source}): it may have been rotated with \`storage-server admin --rotate\` — log in again`,
      );
    if (res.status === 421)
      throw new ApiError(
        421,
        "misdirected",
        `the console only answers requests addressed to an IP address or localhost (its DNS-rebinding guard): use ${DEFAULT_CONSOLE_URL}, through an SSH tunnel if the server is elsewhere`,
      );
    throw apiError(res.status, data);
  }

  async json<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.call(method, path, body);
    return parseJson(res.body) as T;
  }

  get<T>(path: string): Promise<T> {
    return this.json<T>("GET", path);
  }

  /** A call to the device API itself (`/v1/…`) as the admin device. */
  async device<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${await this.deviceToken()}`,
    };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    let res: HttpResponse;
    try {
      res = await this.raw(
        method,
        this.target.url.replace(/\/+$/, "") + path,
        headers,
        body === undefined ? undefined : JSON.stringify(body),
      );
    } catch (err) {
      throw explainNetwork(err, this.target);
    }
    const data = parseJson(res.body);
    if (res.status === 401) {
      this.dropToken();
      throw new AuthError(
        `the server rejected this admin device (${this.target.source})`,
      );
    }
    if (res.status >= 400) throw apiError(res.status, data);
    return data as T;
  }

  /** Follow a Server-Sent Events endpoint until the stream or signal ends. */
  async events(path: string): Promise<IncomingMessage> {
    const url = this.urlFor(path);
    const headers = {
      Authorization: await this.authHeader(),
      Accept: "text/event-stream",
    };
    let res: IncomingMessage;
    try {
      res = await open({
        method: "GET",
        url,
        headers,
        fp: this.fp(),
        signal: this.opts.signal,
        // A stream is idle between entries; the server pings every 25 s.
        timeoutMs: 120_000,
      });
    } catch (err) {
      throw explainNetwork(err, this.target);
    }
    this.opts.debug?.(`GET ${url} → ${res.statusCode}`);
    if ((res.statusCode ?? 0) >= 400) {
      const chunks: Buffer[] = [];
      for await (const c of res) chunks.push(c as Buffer);
      const data = parseJson(Buffer.concat(chunks));
      if (res.statusCode === 401)
        throw new AuthError(
          `the credentials were rejected (${this.target.source})`,
        );
      throw apiError(res.statusCode!, data);
    }
    return res;
  }
}

export function parseJson(body: Buffer): unknown {
  const text = body.toString("utf8");
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function errorMessage(data: unknown, status: number): string {
  const e = (data as { error?: { message?: string } } | null)?.error;
  if (e?.message) return e.message;
  if (typeof data === "string" && data.trim()) return data.trim().slice(0, 200);
  return `HTTP ${status}`;
}

function apiError(status: number, data: unknown): ApiError {
  const code =
    (data as { error?: { code?: string } } | null)?.error?.code ?? "error";
  return new ApiError(status, code, errorMessage(data, status));
}

function explainNetwork(err: unknown, target: Target): unknown {
  if (!(err instanceof NetworkError)) return err;
  const refused = err.code === "ECONNREFUSED";
  const hint =
    target.auth.type === "token"
      ? refused
        ? " — is the server running? The console listens on the server's loopback: use an SSH tunnel (ssh -L 8081:127.0.0.1:8081 <server>), or log in as an admin device"
        : ""
      : refused
        ? " — is the server running, and is this its public URL?"
        : err.code === "DEPTH_ZERO_SELF_SIGNED_CERT" ||
            err.code === "SELF_SIGNED_CERT_IN_CHAIN"
          ? " — the server uses a self-signed certificate: pin it with --fingerprint (or STORAGE_FINGERPRINT); pairing payloads carry it"
          : "";
  return new NetworkError(
    err.url,
    `cannot reach ${err.url}: ${err.message}${hint}`,
    err.code,
  );
}
