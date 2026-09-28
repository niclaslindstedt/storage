// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// `storage-mcp serve`: the MCP server on stdio, for one paired agent device.

import type { Readable, Writable } from "node:stream";

import { createAuditLog } from "./audit.ts";
import type { McpConfig } from "./config.ts";
import { createOutbox } from "./outbox.ts";
import { McpServer } from "./protocol/server.ts";
import { stdioChannel } from "./protocol/stdio.ts";
import { openSession, type Session } from "./session.ts";
import { instructions, serverTools } from "./tools/index.ts";
import type { Deps } from "./tools/registry.ts";
import { VERSION } from "./version.ts";

export class UnscopedDeviceError extends Error {
  constructor() {
    super(
      'this device is an ordinary, unscoped device: an agent should run on an agent device the server holds to a scope. Pair one with `storage-server pair --account <you> --agent` (or narrow this device in the admin console), or set "allowUnscoped": true in config.json to accept the risk.',
    );
  }
}

export function createMcp(
  session: Session,
  config: McpConfig,
  dir: string,
  send: (m: unknown) => void,
  log: (level: "info" | "warn" | "error", message: string) => void,
): McpServer {
  if (!session.me.agent && !config.allowUnscoped)
    throw new UnscopedDeviceError();
  const outbox = createOutbox(dir);
  outbox.prune();
  const deps: Deps = {
    session,
    client: session.client,
    config,
    outbox,
    now: Date.now,
  };
  return new McpServer({
    info: {
      name: "storage-mcp",
      title: "Storage",
      version: VERSION,
      description:
        "Your self-hosted, end-to-end encrypted storage server, as a scoped agent device.",
      websiteUrl: "https://github.com/niclaslindstedt/storage",
    },
    instructions: instructions(deps),
    tools: serverTools(deps),
    send,
    log,
    onCall: config.audit ? createAuditLog(dir) : undefined,
    limits: config.limits,
  });
}

export async function serve(opts: {
  dir: string;
  config: McpConfig;
  input: Readable;
  output: Writable;
  log: (level: "info" | "warn" | "error", message: string) => void;
  env?: NodeJS.ProcessEnv;
}): Promise<void> {
  const session = await openSession(opts.dir, opts.config, opts.env);
  let server: McpServer | null = null;
  await new Promise<void>((resolve) => {
    const channel = stdioChannel(
      opts.input,
      opts.output,
      (m) => void server?.receive(m),
      () => {
        server?.close();
        resolve();
      },
      {
        onParseError: () =>
          channel.send({
            jsonrpc: "2.0",
            id: null,
            error: { code: -32700, message: "parse error" },
          }),
      },
    );
    server = createMcp(session, opts.config, opts.dir, channel.send, opts.log);
    opts.log(
      "info",
      `storage-mcp ${VERSION}: serving ${session.profile.server} as device ${session.me.deviceId}`,
    );
  });
}
