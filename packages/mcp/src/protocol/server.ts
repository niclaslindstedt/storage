// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// A Model Context Protocol server, written against the specification with
// no SDK (the package keeps zero runtime dependencies: less to audit, no
// supply chain to trust). It speaks both eras of the protocol over stdio:
//
// - 2026-07-28: stateless. Every request carries its protocol version and
//   the client's capabilities in `_meta`; `server/discover` describes the
//   server; results carry `resultType`. A tool that needs the human's
//   answer returns `input_required` with an elicitation, and the client
//   retries with the answer and our `requestState` — which is HMAC-sealed,
//   bound to the tool and its exact arguments, short-lived and single-use,
//   so neither a client nor the model can replay or reuse a confirmation.
// - 2024-11-05 … 2025-11-25: `initialize` negotiates once per process; a
//   tool that needs the human sends the client an `elicitation/create`
//   request and waits for the answer.
//
// Only tools are offered (no resources, prompts or sampling), the tool list
// never changes while the process runs, and every call is validated,
// rate limited and bounded in concurrency before a tool sees it.

import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

import { type ObjectSchema, SchemaError, validate } from "./schema.ts";

export const LATEST_PROTOCOL = "2026-07-28";
export const LEGACY_PROTOCOLS = [
  "2025-11-25",
  "2025-06-18",
  "2025-03-26",
  "2024-11-05",
] as const;
export const SUPPORTED_PROTOCOLS = [LATEST_PROTOCOL, ...LEGACY_PROTOCOLS];

const META = {
  version: "io.modelcontextprotocol/protocolVersion",
  capabilities: "io.modelcontextprotocol/clientCapabilities",
  serverInfo: "io.modelcontextprotocol/serverInfo",
} as const;

export const ERR = {
  parse: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internal: -32603,
  unsupportedVersion: -32022,
} as const;

export type PrimitiveSchema =
  | {
      type: "string";
      title?: string;
      description?: string;
      minLength?: number;
      maxLength?: number;
    }
  | { type: "boolean"; title?: string; description?: string; default?: boolean }
  | { type: "string"; title?: string; description?: string; enum: string[] };

export type ElicitParams = {
  message: string;
  requestedSchema: {
    type: "object";
    properties: Record<string, PrimitiveSchema>;
    required?: string[];
  };
};

export type ElicitResult = {
  action: "accept" | "decline" | "cancel";
  content?: Record<string, string | number | boolean | string[]>;
};

export type Content =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

export type ToolResult = {
  content: Content[];
  structuredContent?: unknown;
  isError?: boolean;
};

export type ToolContext = {
  signal: AbortSignal;
  /** Whether this client can ask the human (form elicitation). */
  canElicit: boolean;
  /**
   * Ask the human — not the model — through the client's own UI. Call it
   * before doing anything: with the 2026-07-28 protocol the tool is run
   * again from the start once the answer arrives. At most once per call.
   */
  elicit(params: ElicitParams): Promise<ElicitResult>;
};

export type ServerTool = {
  name: string;
  title: string;
  description: string;
  inputSchema: ObjectSchema;
  outputSchema?: Record<string, unknown>;
  annotations: {
    title?: string;
    readOnlyHint: boolean;
    destructiveHint: boolean;
    idempotentHint: boolean;
    openWorldHint: boolean;
  };
  call(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>;
};

export type ServerInfo = {
  name: string;
  title: string;
  version: string;
  description?: string;
  websiteUrl?: string;
};

export type McpServerOptions = {
  info: ServerInfo;
  instructions: string;
  tools: ServerTool[];
  send(message: unknown): void;
  /** Diagnostics for a person (stderr). Never receives tool arguments. */
  log?(level: "info" | "warn" | "error", message: string): void;
  /** Called after every tool call (the local audit log). */
  onCall?(event: {
    tool: string;
    args: Record<string, unknown>;
    outcome: "ok" | "error" | "denied" | "input_required" | "cancelled";
    ms: number;
  }): void;
  limits?: { callsPerMinute?: number; burst?: number; maxConcurrent?: number };
  now?: () => number;
  /** Seals `requestState` (random per process when absent). */
  stateKey?: Uint8Array;
};

type Id = string | number;
type Msg = {
  jsonrpc?: unknown;
  id?: unknown;
  method?: unknown;
  params?: unknown;
  result?: unknown;
  error?: unknown;
};

class RpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly data?: unknown,
  ) {
    super(message);
  }
}

/**
 * Thrown by `elicit` in the 2026-07-28 era: answer with input_required.
 * Tools must let it through (see `isInputRequired`).
 */
export class InputRequired {
  constructor(readonly params: ElicitParams) {}
}

const STATE_TTL_MS = 10 * 60_000;
const LEGACY_ELICIT_TIMEOUT_MS = 10 * 60_000;
const ELICIT_KEY = "confirm";

/** JSON with sorted keys: equal arguments digest equally. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object")
    return `{${Object.keys(v)
      .sort()
      .map(
        (k) =>
          `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`,
      )
      .join(",")}}`;
  return JSON.stringify(v);
}

const b64u = (b: Uint8Array) => Buffer.from(b).toString("base64url");

export class McpServer {
  private readonly opts: McpServerOptions;
  private readonly tools: Map<string, ServerTool>;
  private readonly now: () => number;
  private readonly stateKey: Uint8Array;
  private readonly usedStates = new Map<string, number>();
  private readonly inflight = new Map<string, AbortController>();
  private readonly pending = new Map<
    string,
    { resolve(r: ElicitResult): void; timer: NodeJS.Timeout }
  >();
  private legacy: { version: string; canElicit: boolean } | null = null;
  private nextId = 1;
  private tokens: number;
  private refilledAt: number;

  constructor(opts: McpServerOptions) {
    this.opts = opts;
    this.tools = new Map(
      [...opts.tools]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((t) => [t.name, t]),
    );
    this.now = opts.now ?? Date.now;
    this.stateKey = opts.stateKey ?? randomBytes(32);
    this.tokens = this.burst;
    this.refilledAt = this.now();
  }

  private get burst(): number {
    return this.opts.limits?.burst ?? 20;
  }

  /** Handle one incoming message (request, notification or response). */
  async receive(raw: unknown): Promise<void> {
    if (Array.isArray(raw))
      return this.reply(
        null,
        undefined,
        new RpcError(ERR.invalidRequest, "batches are not supported"),
      );
    const msg = (raw ?? {}) as Msg;
    if (msg.jsonrpc !== "2.0" || typeof msg !== "object")
      return this.reply(
        null,
        undefined,
        new RpcError(ERR.invalidRequest, "not a JSON-RPC 2.0 message"),
      );
    // A response to one of our requests (legacy elicitation).
    if (
      msg.method === undefined &&
      (msg.result !== undefined || msg.error !== undefined)
    ) {
      const key = String(msg.id);
      const p = this.pending.get(key);
      if (!p) return;
      this.pending.delete(key);
      clearTimeout(p.timer);
      p.resolve(parseElicitResult(msg.result));
      return;
    }
    if (typeof msg.method !== "string")
      return this.reply(
        null,
        undefined,
        new RpcError(ERR.invalidRequest, "method is required"),
      );
    const isRequest = typeof msg.id === "string" || typeof msg.id === "number";
    if (!isRequest) return this.notification(msg.method, msg.params);
    const id = msg.id as Id;
    const key = String(id);
    const params = (msg.params ?? {}) as Record<string, unknown>;
    if (typeof params !== "object" || Array.isArray(params))
      return this.reply(
        id,
        undefined,
        new RpcError(ERR.invalidParams, "params must be an object"),
      );
    const ac = new AbortController();
    this.inflight.set(key, ac);
    try {
      const out = await this.request(msg.method, params, ac.signal);
      if (!ac.signal.aborted) this.reply(id, out.result, undefined, out.modern);
    } catch (err) {
      if (ac.signal.aborted) return;
      if (err instanceof RpcError) this.reply(id, undefined, err);
      else {
        this.opts.log?.(
          "error",
          `internal error in ${msg.method}: ${(err as Error).message}`,
        );
        this.reply(id, undefined, new RpcError(ERR.internal, "internal error"));
      }
    } finally {
      this.inflight.delete(key);
    }
  }

  private notification(method: string, params: unknown): void {
    if (method === "notifications/cancelled") {
      const p = (params ?? {}) as { requestId?: unknown };
      this.inflight.get(String(p.requestId))?.abort();
    }
    // notifications/initialized and anything else: nothing to do.
  }

  private reply(
    id: Id | null,
    result: unknown,
    error?: RpcError,
    modern = false,
  ): void {
    if (error) {
      this.opts.send({
        jsonrpc: "2.0",
        id,
        error: {
          code: error.code,
          message: error.message,
          ...(error.data !== undefined ? { data: error.data } : {}),
        },
      });
      return;
    }
    const body = result as Record<string, unknown>;
    this.opts.send({
      jsonrpc: "2.0",
      id,
      result: modern
        ? {
            resultType: "complete",
            ...body,
            _meta: { [META.serverInfo]: this.opts.info },
          }
        : body,
    });
  }

  /** Close: fail pending elicitations, abort running calls. */
  close(): void {
    for (const [k, p] of this.pending) {
      clearTimeout(p.timer);
      p.resolve({ action: "cancel" });
      this.pending.delete(k);
    }
    for (const ac of this.inflight.values()) ac.abort();
  }

  private async request(
    method: string,
    params: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<{ result: unknown; modern: boolean }> {
    if (method === "initialize")
      return { result: this.initialize(params), modern: false };
    if (method === "ping") return { result: {}, modern: false };
    const meta = (params._meta ?? {}) as Record<string, unknown>;
    const version = meta[META.version];
    if (version === undefined) {
      if (!this.legacy)
        throw new RpcError(
          ERR.invalidParams,
          `missing _meta["${META.version}"]: send initialize first, or use protocol ${LATEST_PROTOCOL}`,
        );
      return {
        result: await this.dispatch(method, params, signal, null),
        modern: false,
      };
    }
    if (version !== LATEST_PROTOCOL)
      throw new RpcError(
        ERR.unsupportedVersion,
        "unsupported protocol version",
        {
          supported: SUPPORTED_PROTOCOLS,
          requested: version,
        },
      );
    const caps = meta[META.capabilities];
    if (typeof caps !== "object" || caps === null)
      throw new RpcError(
        ERR.invalidParams,
        `missing _meta["${META.capabilities}"]`,
      );
    return {
      result: await this.dispatch(
        method,
        params,
        signal,
        caps as Record<string, unknown>,
      ),
      modern: true,
    };
  }

  private initialize(params: Record<string, unknown>) {
    const asked = String(params.protocolVersion ?? "");
    const version = (LEGACY_PROTOCOLS as readonly string[]).includes(asked)
      ? asked
      : LEGACY_PROTOCOLS[0];
    const caps = (params.capabilities ?? {}) as Record<string, unknown>;
    this.legacy = { version, canElicit: formElicitation(caps.elicitation) };
    return {
      protocolVersion: version,
      capabilities: { tools: { listChanged: false } },
      serverInfo: this.opts.info,
      instructions: this.opts.instructions,
    };
  }

  /** `caps` null: the legacy era (capabilities from initialize). */
  private async dispatch(
    method: string,
    params: Record<string, unknown>,
    signal: AbortSignal,
    caps: Record<string, unknown> | null,
  ): Promise<unknown> {
    switch (method) {
      case "server/discover":
        if (!caps) break;
        return {
          supportedVersions: SUPPORTED_PROTOCOLS,
          capabilities: { tools: {} },
          instructions: this.opts.instructions,
          ttlMs: 3_600_000,
          cacheScope: "private",
        };
      case "tools/list":
        return {
          tools: [...this.tools.values()].map((t) =>
            this.describe(t, caps !== null),
          ),
          ...(caps ? { ttlMs: 3_600_000, cacheScope: "private" } : {}),
        };
      case "tools/call":
        return this.call(params, signal, caps);
    }
    throw new RpcError(ERR.methodNotFound, `method not found: ${method}`);
  }

  private describe(t: ServerTool, modern: boolean) {
    const structured = modern || this.legacyAtLeast("2025-06-18");
    return {
      name: t.name,
      title: t.title,
      description: t.description,
      inputSchema: t.inputSchema,
      ...(structured && t.outputSchema ? { outputSchema: t.outputSchema } : {}),
      annotations: { title: t.title, ...t.annotations },
    };
  }

  private legacyAtLeast(v: string): boolean {
    return this.legacy !== null && this.legacy.version >= v;
  }

  private takeToken(): boolean {
    const perMinute = this.opts.limits?.callsPerMinute ?? 60;
    const now = this.now();
    this.tokens = Math.min(
      this.burst,
      this.tokens + ((now - this.refilledAt) / 60_000) * perMinute,
    );
    this.refilledAt = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }

  private async call(
    params: Record<string, unknown>,
    signal: AbortSignal,
    caps: Record<string, unknown> | null,
  ): Promise<unknown> {
    const name = params.name;
    const tool = typeof name === "string" ? this.tools.get(name) : undefined;
    if (!tool)
      throw new RpcError(ERR.invalidParams, `unknown tool: ${String(name)}`);
    const args = (params.arguments ?? {}) as Record<string, unknown>;
    const started = this.now();
    const audit = (
      outcome: "ok" | "error" | "denied" | "input_required" | "cancelled",
    ) =>
      this.opts.onCall?.({
        tool: tool.name,
        args,
        outcome,
        ms: this.now() - started,
      });
    const strip = (r: ToolResult) =>
      caps !== null || this.legacyAtLeast("2025-06-18")
        ? r
        : { content: r.content, ...(r.isError ? { isError: true } : {}) };

    try {
      validate(tool.inputSchema, args);
    } catch (err) {
      if (!(err instanceof SchemaError)) throw err;
      audit("denied");
      return strip(errorResult(`invalid arguments: ${err.message}`));
    }
    // A retry carrying an answer is the same logical call: no second token.
    const answer = caps ? this.openState(params, tool.name, args) : null;
    if (!answer && !this.takeToken()) {
      audit("denied");
      return strip(
        errorResult("rate limited: too many tool calls, try again in a minute"),
      );
    }
    if (this.inflight.size > (this.opts.limits?.maxConcurrent ?? 4)) {
      audit("denied");
      return strip(errorResult("busy: too many tool calls at once"));
    }

    const canElicit = caps
      ? formElicitation(caps.elicitation)
      : (this.legacy?.canElicit ?? false);
    let asked = false;
    const ctx: ToolContext = {
      signal,
      canElicit,
      elicit: async (p) => {
        if (asked) throw new Error("a tool may ask the human once per call");
        asked = true;
        if (!canElicit) return { action: "cancel" };
        if (caps) {
          if (answer) return answer;
          throw new InputRequired(p);
        }
        return this.legacyElicit(p, signal);
      },
    };
    try {
      const out = await tool.call(args, ctx);
      if (signal.aborted) {
        audit("cancelled");
        return out;
      }
      audit(out.isError ? "error" : "ok");
      return strip(out);
    } catch (err) {
      if (err instanceof InputRequired) {
        audit("input_required");
        return {
          resultType: "input_required",
          inputRequests: {
            [ELICIT_KEY]: {
              method: "elicitation/create",
              params: { mode: "form", ...err.params },
            },
          },
          requestState: this.sealState(tool.name, args),
        };
      }
      audit(signal.aborted ? "cancelled" : "error");
      return strip(
        errorResult(err instanceof Error ? err.message : String(err)),
      );
    }
  }

  private legacyElicit(
    p: ElicitParams,
    signal: AbortSignal,
  ): Promise<ElicitResult> {
    const id = `storage-mcp-${this.nextId++}`;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve({ action: "cancel" });
      }, LEGACY_ELICIT_TIMEOUT_MS);
      this.pending.set(id, { resolve, timer });
      signal.addEventListener("abort", () => {
        clearTimeout(timer);
        this.pending.delete(id);
        resolve({ action: "cancel" });
      });
      this.opts.send({
        jsonrpc: "2.0",
        id,
        method: "elicitation/create",
        params: this.legacyAtLeast("2025-11-25") ? { mode: "form", ...p } : p,
      });
    });
  }

  // ---- requestState: sealed, bound, short-lived, single use ----------------------

  private digest(tool: string, args: Record<string, unknown>): string {
    return createHash("sha256")
      .update(`${tool}\n${canonical(args)}`)
      .digest("base64url");
  }

  private mac(body: string): Buffer {
    return createHmac("sha256", this.stateKey)
      .update(`storage-mcp/state/v1|${body}`)
      .digest();
  }

  private sealState(tool: string, args: Record<string, unknown>): string {
    const body = b64u(
      Buffer.from(
        JSON.stringify({
          d: this.digest(tool, args),
          exp: this.now() + STATE_TTL_MS,
          n: b64u(randomBytes(16)),
        }),
      ),
    );
    return `${body}.${b64u(this.mac(body))}`;
  }

  /**
   * The human's answer from a retried call, after checking the state it came
   * with; null when the call carries none. A forged, stale, reused or
   * mismatched state is refused outright.
   */
  private openState(
    params: Record<string, unknown>,
    tool: string,
    args: Record<string, unknown>,
  ): ElicitResult | null {
    const state = params.requestState;
    const responses = params.inputResponses as
      Record<string, unknown> | undefined;
    if (state === undefined && responses === undefined) return null;
    if (
      typeof state !== "string" ||
      !responses ||
      typeof responses !== "object"
    )
      throw new RpcError(
        ERR.invalidParams,
        "inputResponses and requestState go together",
      );
    const [body, tag] = state.split(".");
    if (!body || !tag)
      throw new RpcError(ERR.invalidParams, "invalid requestState");
    const want = this.mac(body);
    const got = Buffer.from(tag, "base64url");
    if (got.length !== want.length || !timingSafeEqual(got, want))
      throw new RpcError(ERR.invalidParams, "invalid requestState");
    // Authentic (the MAC matched), so ours: parsing cannot meet hostile input.
    const s = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as {
      d: string;
      exp: number;
      n: string;
    };
    const now = this.now();
    for (const [n, exp] of this.usedStates)
      if (exp < now) this.usedStates.delete(n);
    if (s.exp < now)
      throw new RpcError(
        ERR.invalidParams,
        "requestState expired: call the tool again",
      );
    if (s.d !== this.digest(tool, args))
      throw new RpcError(
        ERR.invalidParams,
        "requestState belongs to another call",
      );
    if (this.usedStates.has(s.n))
      throw new RpcError(ERR.invalidParams, "requestState already used");
    this.usedStates.set(s.n, s.exp);
    return parseElicitResult(responses[ELICIT_KEY]);
  }
}

function formElicitation(cap: unknown): boolean {
  if (typeof cap !== "object" || cap === null) return false;
  const c = cap as Record<string, unknown>;
  // `{}` means form mode (the default); `{url: {}}` alone means URL only.
  return Object.keys(c).length === 0 || c.form !== undefined;
}

function parseElicitResult(raw: unknown): ElicitResult {
  const r = (raw ?? {}) as { action?: unknown; content?: unknown };
  if (r.action === "accept")
    return {
      action: "accept",
      content:
        typeof r.content === "object" && r.content !== null
          ? (r.content as ElicitResult["content"])
          : {},
    };
  return { action: r.action === "decline" ? "decline" : "cancel" };
}

export function errorResult(message: string): ToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}
