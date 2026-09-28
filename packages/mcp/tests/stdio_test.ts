// The built `storage-mcp` binary, as an MCP client runs it: pair at a
// terminal (approved from the phone), `serve` over real stdio, then
// `unpair`. Needs `npm run build` (make test builds first).

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { pairingUri } from "../../server/src/payload.ts";
import { createPairing } from "../../server/src/services/pairing.ts";
import { parseScope } from "../../server/src/services/scope.ts";
import { closeAll, drive, home } from "./helpers.ts";

const BIN = fileURLToPath(new URL("../dist/cli.js", import.meta.url));

afterEach(closeAll);

function run(args: string[], env: NodeJS.ProcessEnv) {
  const child = spawn(process.execPath, [BIN, ...args], {
    env: { ...process.env, ...env },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (d) => (stdout += d));
  child.stderr.on("data", (d) => (stderr += d));
  const exit = new Promise<number>((r) =>
    child.on("close", (code) => r(code ?? -1)),
  );
  return { child, exit, out: () => stdout, err: () => stderr };
}

async function until(check: () => boolean, ms = 15_000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 50));
  }
}

describe("storage-mcp over stdio", () => {
  it("pairs, serves both protocol eras on stdout only, and unpairs", async () => {
    expect(existsSync(BIN), "build packages/mcp first (make build)").toBe(true);
    const h = await home();
    await drive(h.phone, "Journal", { "day.md": "a good day" });
    const env = {
      STORAGE_MCP_HOME: mkdtempSync(join(tmpdir(), "storage-mcp-bin-")),
    };
    const code = createPairing(
      h.app.ctx,
      {
        accountId: h.account.id,
        scope: parseScope({ perms: ["data:read"], apps: ["drive"] }),
      },
      "cli",
    ).code!;

    // A person pairs it; the phone approves it after comparing codes.
    const pair = run(
      ["pair", pairingUri({ server: h.url, code }), "--name", "claude"],
      env,
    );
    await until(() => pair.out().includes("Waiting for approval"));
    const [pending] = await h.phone.pendingDevices();
    expect(pair.out()).toContain(pending!.safetyCode);
    await h.phone.approveDevice(pending!.id);
    expect(await pair.exit).toBe(0);
    expect(pair.out()).toMatch(
      /Agent scope \(enforced by the server\): data:read; apps: drive/,
    );

    const status = run(["status", "--json"], env);
    expect(await status.exit).toBe(0);
    expect(JSON.parse(status.out())).toMatchObject({
      accountKey: true,
      scope: { perms: ["data:read"] },
    });

    // An MCP client talks to it.
    const serve = run(["serve"], env);
    const lines = () =>
      serve
        .out()
        .split("\n")
        .filter(Boolean)
        .map(
          (l) =>
            JSON.parse(l) as { id?: number; result?: Record<string, unknown> },
        );
    const send = (m: unknown) =>
      serve.child.stdin.write(`${JSON.stringify(m)}\n`);
    send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "t", version: "1" },
      },
    });
    send({ jsonrpc: "2.0", method: "notifications/initialized" });
    send({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "list_namespaces", arguments: {} },
    });
    send({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/list",
      params: {
        _meta: {
          "io.modelcontextprotocol/protocolVersion": "2026-07-28",
          "io.modelcontextprotocol/clientCapabilities": {},
        },
      },
    });
    await until(() => lines().length >= 3);
    const [init, called, listed] = [1, 2, 3].map((id) =>
      lines().find((l) => l.id === id)!,
    );
    expect(init!.result).toMatchObject({
      protocolVersion: "2025-06-18",
      serverInfo: { name: "storage-mcp" },
    });
    expect(JSON.stringify(called!.result)).toContain("Journal");
    expect(listed!.result).toMatchObject({
      resultType: "complete",
      cacheScope: "private",
    });
    serve.child.stdin.end();
    expect(await serve.exit).toBe(0);
    // stdout carried JSON-RPC only; the person's diagnostics went to stderr.
    expect(
      serve
        .out()
        .split("\n")
        .filter(Boolean)
        .every((l) => l.startsWith('{"jsonrpc":"2.0"')),
    ).toBe(true);
    expect(serve.err()).toMatch(/serving http:\/\/127\.0\.0\.1/);

    const unpair = run(["unpair"], env);
    expect(await unpair.exit).toBe(0);
    const devices = await h.phone.devices();
    expect(devices.find((d) => d.name === "claude")?.revokedAt).not.toBeNull();
    const again = run(["serve"], env);
    expect(await again.exit).toBe(1);
    expect(again.err()).toMatch(/not paired/);
  });
  it("finishes the key step later with the recovery key", async () => {
    const h = await home();
    const env = {
      STORAGE_MCP_HOME: mkdtempSync(join(tmpdir(), "storage-mcp-bin-")),
    };
    const code = createPairing(
      h.app.ctx,
      { accountId: h.account.id, scope: parseScope({ perms: ["data:read"] }) },
      "cli",
    ).code!;
    const first = run(["pair", pairingUri({ server: h.url, code })], env);
    await until(() => first.out().includes("Waiting for approval"));
    first.child.kill("SIGINT");
    await first.exit;
    const status = run(["status", "--json"], env);
    expect(await status.exit).toBe(0);
    expect(JSON.parse(status.out())).toMatchObject({ accountKey: false });

    const recover = run(["pair", "--recover"], env);
    recover.child.stdin.end(`${h.recoveryKey}\n`);
    expect(await recover.exit).toBe(0);
    expect(recover.out()).toContain("The account key is on this device.");
    // The recovery key was read, never printed.
    expect(recover.out() + recover.err()).not.toContain(h.recoveryKey);
    const after = run(["status", "--json"], env);
    expect(await after.exit).toBe(0);
    expect(JSON.parse(after.out())).toMatchObject({ accountKey: true });
  });
});
