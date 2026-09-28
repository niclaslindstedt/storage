// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Tool definitions, and the rules that turn them into what one agent is
// offered. A tool is listed only when every layer allows it:
//
//   the device's scope (server-enforced)  ∩  admin device (console tools)
//   ∩  the local policy (groups, levels, deny/allow)  ∩  secrets policy
//
// Around every call: arguments are validated (the protocol layer), the
// namespace is checked against the local app/folder limits, a human
// confirms what the tool marks as needing it — through the client's own UI
// (elicitation), never through the model — and results are cleaned, fenced
// and capped (text.ts).

import type { SelfHostedClient } from "@niclaslindstedt/oss-framework/storage/selfhosted";

import type { Group, Level, McpConfig } from "../config.ts";
import type { Outbox } from "../outbox.ts";
import {
  type ElicitParams,
  errorResult,
  InputRequired,
  type ServerTool,
  type ToolContext,
  type ToolResult,
} from "../protocol/server.ts";
import type { ObjectSchema } from "../protocol/schema.ts";
import type { Permission, Session } from "../session.ts";
import { capText, cleanDeep, fence } from "../text.ts";

/** No single result is larger than this, whatever the tool. */
export const MAX_RESULT_BYTES = 1024 * 1024;

export type Deps = {
  session: Session;
  client: SelfHostedClient;
  config: McpConfig;
  outbox: Outbox;
  now(): number;
};

/** A human confirmation a tool needs before it runs. */
export type Confirm = {
  message: string;
  /** The human must type this exact text (a name) to go ahead. */
  typed?: { label: string; expect: string };
  /** The human types a value the tool uses (a safety code). */
  input?: { label: string; description: string };
  /** Ask even when the policy trusts the client's own prompt (`confirm: host`). */
  always?: boolean;
};

export type ToolDef = {
  name: string;
  title: string;
  description: string;
  /** Offered when any of these groups allows `access`. */
  groups: readonly Group[];
  access: "read" | "write";
  /** What the device's scope must grant (checked by the server too). */
  perm: Permission;
  /** Needs an admin device (the console API). */
  console?: boolean;
  /** Needs the account key on this device (decrypts or encrypts). */
  keys?: boolean;
  /** Mints a credential (delivered to the outbox, never to the model). */
  secret?: boolean;
  destructive?: boolean;
  idempotent?: boolean;
  input: ObjectSchema;
  confirm?(
    args: Record<string, unknown>,
    deps: Deps,
  ): Promise<Confirm | null> | Confirm | null;
  run(
    args: Record<string, unknown>,
    deps: Deps,
    extra: { answer?: string },
  ): Promise<ToolResult>;
};

export class ToolError extends Error {}

const RANK: Record<Level, number> = { off: 0, read: 1, write: 2 };

export type Availability = { tool: ToolDef; enabled: boolean; reason?: string };

/** Why a tool is or is not offered to this agent. */
export function availability(
  defs: ToolDef[],
  config: McpConfig,
  me: Session["me"],
  unscopedAllowed: boolean,
): Availability[] {
  const scope = me.agent;
  return defs.map((tool) => {
    const off = (reason: string): Availability => ({
      tool,
      enabled: false,
      reason,
    });
    if (!scope && !unscopedAllowed) return off("not an agent device");
    if (scope && !scope.perms.includes(tool.perm))
      return off(`the device's scope lacks ${tool.perm}`);
    if (tool.console && !me.console) return off("not an admin device");
    if (tool.console && me.account.role !== "admin")
      return off("the account is not an admin");
    if (!tool.groups.some((g) => RANK[config.groups[g]] >= RANK[tool.access]))
      return off(
        `local policy: ${tool.groups.join("/")} ${tool.access === "write" ? "is not writable" : "is off"}`,
      );
    if (config.deny.includes(tool.name)) return off("local policy: denied");
    if (
      config.allow &&
      !config.allow.includes(tool.name) &&
      !tool.groups.some((g) => config.allow!.includes(g))
    )
      return off("local policy: not in allow");
    if (tool.secret && config.secrets === "off")
      return off("local policy: secrets off");
    return { tool, enabled: true };
  });
}

function confirmSchema(c: Confirm): ElicitParams["requestedSchema"] {
  if (c.typed)
    return {
      type: "object",
      properties: {
        confirm: {
          type: "string",
          title: c.typed.label,
          description: `Type ${c.typed.expect} to confirm`,
          maxLength: 200,
        },
      },
      required: ["confirm"],
    };
  if (c.input)
    return {
      type: "object",
      properties: {
        answer: {
          type: "string",
          title: c.input.label,
          description: c.input.description,
          maxLength: 200,
        },
      },
      required: ["answer"],
    };
  return {
    type: "object",
    properties: {
      approve: { type: "boolean", title: "Allow this", default: false },
    },
    required: ["approve"],
  };
}

/** Ask the human; null when the call may go ahead, else why not. */
async function confirmed(
  c: Confirm,
  deps: Deps,
  ctx: ToolContext,
): Promise<{ denied: string } | { answer?: string }> {
  if (deps.config.confirm === "host" && !c.always && !c.input) return {};
  if (!ctx.canElicit)
    return {
      denied:
        'This action needs a person to confirm it, and this MCP client cannot ask them (no elicitation support). Do it in the admin console or Storage Remote, or — if your client asks you before every tool call — set "confirm": "host" in the storage-mcp config.',
    };
  const r = await ctx.elicit({
    message: `storage-mcp asks you, not the agent: ${c.message}`,
    requestedSchema: confirmSchema(c),
  });
  if (r.action !== "accept") return { denied: "The person declined." };
  const content = r.content ?? {};
  if (c.typed) {
    if (String(content.confirm ?? "").trim() !== c.typed.expect)
      return { denied: "The confirmation did not match; nothing was done." };
    return {};
  }
  if (c.input) {
    const answer = String(content.answer ?? "").trim();
    if (!answer) return { denied: "No answer was given; nothing was done." };
    return { answer };
  }
  if (content.approve !== true) return { denied: "The person declined." };
  return {};
}

/** Turn an enabled definition into what the protocol layer serves. */
export function toServerTool(def: ToolDef, deps: Deps): ServerTool {
  const write = def.access === "write";
  return {
    name: def.name,
    title: def.title,
    description:
      def.description +
      (def.secret
        ? " The credential it creates is written to a private file for the person (the result says where); it is never shown to you."
        : ""),
    inputSchema: def.input,
    annotations: {
      readOnlyHint: !write,
      destructiveHint: write && def.destructive === true,
      idempotentHint: !write || def.idempotent === true,
      // One server, reached by this process only (see net.ts).
      openWorldHint: false,
    },
    async call(args, ctx) {
      try {
        // Approved from another device since the server started? Check again.
        if (def.keys && !deps.session.ready)
          deps.session.ready = (await deps.client.refreshKeys()) === "ready";
        if (def.keys && !deps.session.ready)
          throw new ToolError(
            "this agent has no account key yet, so it cannot open encrypted data: approve it from another device (it shows a safety code in `storage-mcp status`) or run `storage-mcp pair --recover`",
          );
        let answer: string | undefined;
        const c = def.confirm ? await def.confirm(args, deps) : null;
        if (c) {
          const r = await confirmed(c, deps, ctx);
          if ("denied" in r) return errorResult(r.denied);
          answer = r.answer;
        }
        return await def.run(args, deps, { answer });
      } catch (err) {
        // The protocol's "ask the human first" signal, not a failure.
        if (err instanceof InputRequired) throw err;
        return errorResult(describeError(err));
      }
    },
  };
}

export function describeError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const name = err.name && err.name !== "Error" ? `${err.name}: ` : "";
  return `${name}${err.message}`;
}

/**
 * A JSON result: structured content plus the same JSON as text. Everything
 * from the server holds strings someone else chose (names, log lines), so
 * the text is cleaned and fenced like any other untrusted data.
 */
export function json(value: unknown, note?: string): ToolResult {
  const clean = cleanDeep(value);
  const capped = capText(JSON.stringify(clean, null, 1), MAX_RESULT_BYTES);
  if (capped.truncated)
    return {
      content: [
        {
          type: "text",
          text: `${fence("json", "storage server (truncated)", capped.text)}\n(truncated at ${MAX_RESULT_BYTES} bytes: ask for less, e.g. with limit)`,
        },
      ],
    };
  const body = fence("json", "storage server", capped.text);
  return {
    content: [{ type: "text", text: note ? `${note}\n${body}` : body }],
    structuredContent:
      clean !== null && typeof clean === "object" && !Array.isArray(clean)
        ? clean
        : { result: clean },
  };
}

export function text(
  message: string,
  structured?: Record<string, unknown>,
): ToolResult {
  return {
    content: [{ type: "text", text: message }],
    ...(structured ? { structuredContent: cleanDeep(structured) } : {}),
  };
}
