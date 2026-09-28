// The MCP protocol layer on its own, with stand-in tools: both protocol
// eras, validation, elicitation (MRTR and legacy), requestState integrity,
// rate limits, cancellation and stdio framing.

import { PassThrough } from "node:stream";

import { describe, expect, it } from "vitest";

import {
  LATEST_PROTOCOL,
  McpServer,
  type ServerTool,
  SUPPORTED_PROTOCOLS,
} from "../src/protocol/server.ts";
import { s } from "../src/protocol/schema.ts";
import { stdioChannel } from "../src/protocol/stdio.ts";

type Reply = {
  id?: unknown;
  method?: string;
  params?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: { code: number; message: string; data?: Record<string, unknown> };
};

const meta = (caps: Record<string, unknown> = {}) => ({
  "io.modelcontextprotocol/protocolVersion": LATEST_PROTOCOL,
  "io.modelcontextprotocol/clientCapabilities": caps,
});

function tools(log: string[]): ServerTool[] {
  return [
    {
      name: "echo",
      title: "Echo",
      description: "Echo text.",
      inputSchema: s.object({ text: s.string("Text", { maxLength: 10 }) }, [
        "text",
      ]),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      async call(args) {
        log.push(`echo:${String(args.text)}`);
        return {
          content: [{ type: "text", text: String(args.text) }],
          structuredContent: { text: args.text },
        };
      },
    },
    {
      name: "danger",
      title: "Danger",
      description: "Asks first.",
      inputSchema: s.object({ target: s.string("What", { maxLength: 20 }) }, [
        "target",
      ]),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
      async call(args, ctx) {
        const r = await ctx.elicit({
          message: `Delete ${String(args.target)}?`,
          requestedSchema: {
            type: "object",
            properties: { ok: { type: "boolean" } },
            required: ["ok"],
          },
        });
        if (r.action !== "accept" || r.content?.ok !== true)
          return {
            content: [{ type: "text", text: "declined" }],
            isError: true,
          };
        log.push(`deleted:${String(args.target)}`);
        return { content: [{ type: "text", text: "done" }] };
      },
    },
    {
      name: "slow",
      title: "Slow",
      description: "Waits until aborted.",
      inputSchema: s.object({}),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      call: (_a, ctx) =>
        new Promise((resolve) =>
          ctx.signal.addEventListener("abort", () =>
            resolve({ content: [{ type: "text", text: "aborted" }] }),
          ),
        ),
    },
  ];
}

function harness(
  opts: {
    now?: () => number;
    limits?: { callsPerMinute?: number; burst?: number };
  } = {},
) {
  const sent: Reply[] = [];
  const log: string[] = [];
  let answer: ((req: Reply) => unknown) | null = null;
  const server: McpServer = new McpServer({
    info: { name: "t", title: "T", version: "1" },
    instructions: "test",
    tools: tools(log),
    send: (m) => {
      const r = m as Reply;
      sent.push(r);
      // A request from the server (legacy elicitation): the "client" answers.
      if (r.method && answer) {
        const result = answer(r);
        queueMicrotask(
          () => void server.receive({ jsonrpc: "2.0", id: r.id, result }),
        );
      }
    },
    now: opts.now,
    limits: opts.limits,
  });
  let id = 0;
  const rpc = async (method: string, params: Record<string, unknown> = {}) => {
    const my = ++id;
    await server.receive({ jsonrpc: "2.0", id: my, method, params });
    return sent.find((r) => r.id === my)!;
  };
  return {
    server,
    sent,
    log,
    rpc,
    onRequest: (f: (req: Reply) => unknown) => (answer = f),
  };
}

describe("2026-07-28 (stateless)", () => {
  it("requires the protocol version and capabilities on every request", async () => {
    const h = harness();
    expect((await h.rpc("tools/list")).error?.code).toBe(-32602);
    const bad = await h.rpc("tools/list", {
      _meta: {
        "io.modelcontextprotocol/protocolVersion": "2099-01-01",
        "io.modelcontextprotocol/clientCapabilities": {},
      },
    });
    expect(bad.error?.code).toBe(-32022);
    expect(bad.error?.data).toEqual({
      supported: SUPPORTED_PROTOCOLS,
      requested: "2099-01-01",
    });
    const noCaps = await h.rpc("tools/list", {
      _meta: { "io.modelcontextprotocol/protocolVersion": LATEST_PROTOCOL },
    });
    expect(noCaps.error?.code).toBe(-32602);
  });

  it("describes itself with server/discover", async () => {
    const h = harness();
    const r = await h.rpc("server/discover", { _meta: meta() });
    expect(r.result).toMatchObject({
      resultType: "complete",
      supportedVersions: SUPPORTED_PROTOCOLS,
      capabilities: { tools: {} },
      instructions: "test",
      cacheScope: "private",
      _meta: { "io.modelcontextprotocol/serverInfo": { name: "t" } },
    });
  });

  it("lists tools sorted, with annotations and cache hints", async () => {
    const h = harness();
    const r = await h.rpc("tools/list", { _meta: meta() });
    const list = r.result!.tools as {
      name: string;
      annotations: Record<string, unknown>;
    }[];
    expect(list.map((t) => t.name)).toEqual(["danger", "echo", "slow"]);
    expect(list[0]!.annotations).toMatchObject({
      destructiveHint: true,
      openWorldHint: false,
    });
    expect(r.result).toMatchObject({
      resultType: "complete",
      ttlMs: 3_600_000,
      cacheScope: "private",
    });
  });

  it("validates arguments before a tool runs", async () => {
    const h = harness();
    const call = (args: unknown) =>
      h.rpc("tools/call", { _meta: meta(), name: "echo", arguments: args });
    expect((await call({ text: "hi" })).result).toMatchObject({
      resultType: "complete",
      structuredContent: { text: "hi" },
    });
    const extra = (await call({ text: "hi", sneaky: 1 })).result!;
    expect(extra.isError).toBe(true);
    expect(JSON.stringify(extra.content)).toMatch(
      /sneaky is not a known argument/,
    );
    expect((await call({ text: "x".repeat(11) })).result!.isError).toBe(true);
    expect((await call({})).result!.isError).toBe(true);
    expect(h.log).toEqual(["echo:hi"]);
    const unknown = await h.rpc("tools/call", {
      _meta: meta(),
      name: "nope",
      arguments: {},
    });
    expect(unknown.error?.code).toBe(-32602);
    expect((await h.rpc("resources/list", { _meta: meta() })).error?.code).toBe(
      -32601,
    );
  });

  it("asks the human with input_required and a sealed, single-use requestState", async () => {
    const h = harness();
    const caps = { elicitation: {} };
    const first = await h.rpc("tools/call", {
      _meta: meta(caps),
      name: "danger",
      arguments: { target: "a" },
    });
    expect(first.result).toMatchObject({
      resultType: "input_required",
      inputRequests: {
        confirm: {
          method: "elicitation/create",
          params: { mode: "form", message: "Delete a?" },
        },
      },
    });
    expect(h.log).toEqual([]);
    const state = first.result!.requestState as string;
    const retry = (
      args: Record<string, unknown>,
      requestState: string,
      ok = true,
    ) =>
      h.rpc("tools/call", {
        _meta: meta(caps),
        name: "danger",
        arguments: args,
        inputResponses: { confirm: { action: "accept", content: { ok } } },
        requestState,
      });
    // The answer cannot be moved to other arguments…
    expect((await retry({ target: "b" }, state)).error?.message).toMatch(
      /another call/,
    );
    // …or forged…
    const [body] = state.split(".");
    expect(
      (await retry({ target: "a" }, `${body}.AAAA`)).error?.message,
    ).toMatch(/invalid requestState/);
    // …it works once…
    expect((await retry({ target: "a" }, state)).result).toMatchObject({
      resultType: "complete",
    });
    expect(h.log).toEqual(["deleted:a"]);
    // …and never again.
    expect((await retry({ target: "a" }, state)).error?.message).toMatch(
      /already used/,
    );
    // Answers without state are refused.
    const bare = await h.rpc("tools/call", {
      _meta: meta(caps),
      name: "danger",
      arguments: { target: "a" },
      inputResponses: { confirm: { action: "accept", content: { ok: true } } },
    });
    expect(bare.error?.code).toBe(-32602);
    expect(h.log).toEqual(["deleted:a"]);
  });

  it("expires requestState", async () => {
    let now = 1_000_000;
    const h = harness({ now: () => now });
    const caps = { elicitation: { form: {} } };
    const first = await h.rpc("tools/call", {
      _meta: meta(caps),
      name: "danger",
      arguments: { target: "a" },
    });
    now += 11 * 60_000;
    const late = await h.rpc("tools/call", {
      _meta: meta(caps),
      name: "danger",
      arguments: { target: "a" },
      inputResponses: { confirm: { action: "accept", content: { ok: true } } },
      requestState: first.result!.requestState,
    });
    expect(late.error?.message).toMatch(/expired/);
  });

  it("tells a tool the client cannot ask when elicitation is not declared", async () => {
    const h = harness();
    const r = await h.rpc("tools/call", {
      _meta: meta({}),
      name: "danger",
      arguments: { target: "a" },
    });
    expect(r.result).toMatchObject({ isError: true });
    const urlOnly = await h.rpc("tools/call", {
      _meta: meta({ elicitation: { url: {} } }),
      name: "danger",
      arguments: { target: "a" },
    });
    expect(urlOnly.result).toMatchObject({ isError: true });
    expect(h.log).toEqual([]);
  });
});

describe("2024-11-05 … 2025-11-25 (initialize)", () => {
  it("negotiates a version and serves without _meta afterwards", async () => {
    const h = harness();
    expect((await h.rpc("tools/list")).error?.code).toBe(-32602);
    const init = await h.rpc("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "c", version: "1" },
    });
    expect(init.result).toMatchObject({
      protocolVersion: "2025-06-18",
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "t" },
      instructions: "test",
    });
    const list = await h.rpc("tools/list");
    expect((list.result!.tools as unknown[]).length).toBe(3);
    expect(list.result!.resultType).toBeUndefined();
    expect((await h.rpc("ping")).result).toEqual({});
  });

  it("answers an unknown version with its latest legacy one", async () => {
    const h = harness();
    const init = await h.rpc("initialize", {
      protocolVersion: "1999-01-01",
      capabilities: {},
    });
    expect(init.result!.protocolVersion).toBe("2025-11-25");
  });

  it("drops structured output for clients older than 2025-06-18", async () => {
    const h = harness();
    await h.rpc("initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
    });
    const r = await h.rpc("tools/call", {
      name: "echo",
      arguments: { text: "hi" },
    });
    expect(r.result).toEqual({ content: [{ type: "text", text: "hi" }] });
  });

  it("elicits with a server-to-client request", async () => {
    const h = harness();
    await h.rpc("initialize", {
      protocolVersion: "2025-11-25",
      capabilities: { elicitation: {} },
    });
    const asked: Reply[] = [];
    h.onRequest((req) => {
      asked.push(req);
      return { action: "accept", content: { ok: true } };
    });
    const r = await h.rpc("tools/call", {
      name: "danger",
      arguments: { target: "x" },
    });
    expect(asked[0]).toMatchObject({
      method: "elicitation/create",
      params: { mode: "form", message: "Delete x?" },
    });
    expect(r.result).toMatchObject({
      content: [{ type: "text", text: "done" }],
    });
    h.onRequest(() => ({ action: "decline" }));
    const no = await h.rpc("tools/call", {
      name: "danger",
      arguments: { target: "y" },
    });
    expect(no.result).toMatchObject({ isError: true });
    expect(h.log).toEqual(["deleted:x"]);
  });
});

describe("limits", () => {
  it("rate limits tool calls with a token bucket", async () => {
    let now = 0;
    const h = harness({
      now: () => now,
      limits: { callsPerMinute: 60, burst: 3 },
    });
    const call = () =>
      h.rpc("tools/call", {
        _meta: meta(),
        name: "echo",
        arguments: { text: "a" },
      });
    for (let i = 0; i < 3; i++)
      expect((await call()).result!.isError).toBeUndefined();
    const limited = await call();
    expect(limited.result!.isError).toBe(true);
    expect(JSON.stringify(limited.result)).toMatch(/rate limited/);
    now += 1000; // one token per second at 60/min
    expect((await call()).result!.isError).toBeUndefined();
  });

  it("stops a cancelled call and never answers it", async () => {
    const h = harness();
    const pending = h.server.receive({
      jsonrpc: "2.0",
      id: 99,
      method: "tools/call",
      params: { _meta: meta(), name: "slow", arguments: {} },
    });
    await h.server.receive({
      jsonrpc: "2.0",
      method: "notifications/cancelled",
      params: { requestId: 99 },
    });
    await pending;
    expect(h.sent.find((r) => r.id === 99)).toBeUndefined();
  });

  it("refuses batches and non-JSON-RPC messages", async () => {
    const h = harness();
    await h.server.receive([{ jsonrpc: "2.0", id: 1, method: "ping" }]);
    await h.server.receive({ id: 2, method: "ping" });
    expect(h.sent.map((r) => r.error?.code)).toEqual([-32600, -32600]);
  });
});

describe("stdio framing", () => {
  it("reads one message per line and writes one line per message", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const got: unknown[] = [];
    let parseErrors = 0;
    const ch = stdioChannel(
      input,
      output,
      (m) => got.push(m),
      () => {},
      {
        maxLineBytes: 64,
        onParseError: () => parseErrors++,
      },
    );
    input.write('{"a":1}\n{"b"');
    input.write(":2}\nnot json\n");
    input.write(`${"x".repeat(100)}`);
    input.write('still the long line\n{"c":3}\n');
    await new Promise((r) => setImmediate(r));
    expect(got).toEqual([{ a: 1 }, { b: 2 }, { c: 3 }]);
    expect(parseErrors).toBe(2);
    ch.send({ text: "line\nbreak" });
    expect(String(output.read())).toBe('{"text":"line\\nbreak"}\n');
  });
});
