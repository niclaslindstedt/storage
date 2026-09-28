// A real storage server in process, a phone (the framework client, with the
// account key) and an agent device paired with a scope — then the MCP
// server for that agent, driven over its message interface.

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createMemoryKeyVault,
  createSelfHostedClient,
  type SelfHostedClient,
} from "@niclaslindstedt/oss-framework/storage/selfhosted";

import {
  createStorageServer,
  type StorageServer,
} from "../../server/src/app.ts";
import { createMemoryLogger } from "../../server/src/log.ts";
import { pairingUri } from "../../server/src/payload.ts";
import { createAccount } from "../../server/src/services/accounts.ts";
import { createPairing } from "../../server/src/services/pairing.ts";
import { parseScope } from "../../server/src/services/scope.ts";
import {
  applyFlags,
  defaultConfig,
  type McpConfig,
  type PolicyFlags,
} from "../src/config.ts";
import { LATEST_PROTOCOL, type McpServer } from "../src/protocol/server.ts";
import { createMcp } from "../src/serve.ts";
import { newClient, openSession, writeProfile } from "../src/session.ts";
import { ensurePrivateDir, openFileVault } from "../src/vault.ts";

export type Reply = {
  id?: unknown;
  method?: string;
  params?: Record<string, unknown>;
  result?: Record<string, unknown> & {
    content?: { type: string; text: string }[];
    structuredContent?: Record<string, unknown>;
    isError?: boolean;
  };
  error?: { code: number; message: string };
};

const open: StorageServer[] = [];
export async function closeAll(): Promise<void> {
  for (const s of open.splice(0)) await s.close();
}

export async function home(role: "admin" | "member" = "admin") {
  const app = createStorageServer({
    log: createMemoryLogger(),
    // Every test pairs several devices; the public rate limit is not under test.
    config: {
      name: "home",
      tls: { mode: "off" },
      rateLimit: { publicPerMinute: 100_000, devicePerMinute: 100_000 },
    },
    console: {},
  });
  const url = await app.listen(0, "127.0.0.1");
  open.push(app);
  const account = createAccount(app.ctx, { name: "niclas", role });
  const phone = createSelfHostedClient({
    vault: createMemoryKeyVault(),
    app: "drive",
  });
  await phone.pair(
    pairingUri({
      server: url,
      code: createPairing(app.ctx, { accountId: account.id }, "cli").code!,
    }),
    {
      name: "phone",
    },
  );
  const recoveryKey = await phone.createAccountKeys();
  return { app, url, account, phone, recoveryKey };
}

export type Home = Awaited<ReturnType<typeof home>>;

/** Pair an agent device (scope enforced by the server), approve it from the phone. */
export async function agent(
  h: Home,
  opts: {
    perms?: string[];
    apps?: string[];
    console?: boolean;
    unscoped?: boolean;
    approve?: boolean;
    config?: Partial<McpConfig>;
    flags?: PolicyFlags;
  } = {},
) {
  const dir = join(mkdtempSync(join(tmpdir(), "storage-mcp-")), "default");
  ensurePrivateDir(dir);
  const code = createPairing(
    h.app.ctx,
    {
      accountId: h.account.id,
      console: opts.console === true,
      scope: opts.unscoped
        ? undefined
        : parseScope({ perms: opts.perms ?? ["data:read"], apps: opts.apps }),
    },
    "cli",
  ).code!;
  const profile = { server: h.url };
  const client = newClient(openFileVault(dir, { kind: "keyfile" }), profile, {
    allowInsecureHttp: false,
  });
  await client.pair(pairingUri({ server: h.url, code }), {
    name: "agent",
    platform: "mcp",
  });
  writeProfile(dir, profile);
  if (opts.approve !== false)
    await h.phone.approveDevice(client.session!.deviceId);
  const config = applyFlags(
    { ...defaultConfig(), ...opts.config },
    opts.flags ?? {},
  );
  const session = await openSession(dir, config, {});
  const sent: Reply[] = [];
  let answer: ((req: Reply) => unknown) | null = null;
  const mcp: McpServer = createMcp(
    session,
    config,
    dir,
    (m) => {
      const r = m as Reply;
      sent.push(r);
      if (r.method && answer) {
        const result = answer(r);
        queueMicrotask(
          () => void mcp.receive({ jsonrpc: "2.0", id: r.id, result }),
        );
      }
    },
    () => {},
  );
  let id = 0;
  const meta = (caps: Record<string, unknown>) => ({
    "io.modelcontextprotocol/protocolVersion": LATEST_PROTOCOL,
    "io.modelcontextprotocol/clientCapabilities": caps,
  });
  const rpc = async (method: string, params: Record<string, unknown>) => {
    const my = ++id;
    await mcp.receive({ jsonrpc: "2.0", id: my, method, params });
    return sent.find((r) => r.id === my)!;
  };
  const tools = async () =>
    (
      (await rpc("tools/list", { _meta: meta({}) })).result!.tools as {
        name: string;
      }[]
    ).map((t) => t.name);
  /** Call a tool; `human` answers a confirmation (MRTR retry) when asked. */
  const call = async (
    name: string,
    args: Record<string, unknown> = {},
    human?:
      | { action: "accept" | "decline"; content?: Record<string, unknown> }
      | "no-ui",
  ) => {
    const caps = human === "no-ui" ? {} : { elicitation: {} };
    const first = await rpc("tools/call", {
      _meta: meta(caps),
      name,
      arguments: args,
    });
    if (first.result?.resultType !== "input_required") return first;
    if (!human || human === "no-ui")
      throw new Error(`${name} asked the human unexpectedly`);
    const asked = first.result.inputRequests as Record<
      string,
      { params: { message: string } }
    >;
    const second = await rpc("tools/call", {
      _meta: meta(caps),
      name,
      arguments: args,
      inputResponses: { confirm: human },
      requestState: first.result.requestState,
    });
    return Object.assign(second, { asked: asked.confirm!.params.message });
  };
  return {
    dir,
    client,
    session,
    mcp,
    rpc,
    tools,
    call,
    sent,
    onRequest: (f: (r: Reply) => unknown) => (answer = f),
  };
}

export const textOf = (r: Reply) =>
  r.result?.content?.map((c) => c.text).join("\n") ?? "";

export async function drive(
  phone: SelfHostedClient,
  name: string,
  files: Record<string, string>,
  app = "drive",
) {
  const ns = await phone.createNamespace({ name }, app);
  for (const [path, text] of Object.entries(files))
    await ns.files.write(path, text);
  return ns;
}
