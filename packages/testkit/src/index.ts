// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// @niclaslindstedt/storage-testkit — a real storage server for tests.
//
//   const server = await startTestServer();        // in-process (Vitest, Node)
//   const server = await startTestServerProcess(); // child process (Playwright)
//
// Both return the same `TestServer`: seed accounts, inject faults, move the
// clock, snapshot and restore, reset. The server is the production server in
// test mode — not a mock — running on an in-memory database.

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";

import {
  createStorageServer,
  type StorageServer,
} from "@niclaslindstedt/storage-server";

import { controlClient, type TestServer } from "./control.ts";

export type {
  AccountRole,
  FaultOptions,
  SeededAccount,
  TestServer,
} from "./control.ts";
export type { FaultRule, Snapshot } from "@niclaslindstedt/storage-server";

export type TestServerOptions = {
  /** Port to listen on; 0 (default) picks a free one. */
  port?: number;
  host?: string;
  secret?: string;
  /** Server display name. */
  name?: string;
};

/** The in-process test server; `.server` gives direct access to the internals. */
export async function startTestServer(
  options: TestServerOptions = {},
): Promise<TestServer & { server: StorageServer }> {
  const server = createStorageServer({
    config: {
      name: options.name ?? "test",
      testMode: true,
      testSecret: options.secret ?? null,
      cors: { mode: "any" },
      rateLimit: { publicPerMinute: 1_000_000, devicePerMinute: 1_000_000 },
    },
  });
  const url = await server.listen(
    options.port ?? 0,
    options.host ?? "127.0.0.1",
  );
  return Object.assign(
    controlClient(url, server.testSecret!, () => server.close()),
    { server },
  );
}

/** The storage-server CLI entry of the installed server package. */
function serverCli(): string {
  const require = createRequire(import.meta.url);
  return join(
    dirname(require.resolve("@niclaslindstedt/storage-server/package.json")),
    "dist",
    "cli.js",
  );
}

/**
 * Start `storage-server test-server` as a child process — for Playwright's
 * `globalSetup`, or any test runner in any language (it prints its URL).
 */
export async function startTestServerProcess(
  options: TestServerOptions & { cli?: string } = {},
): Promise<TestServer> {
  const args = [
    options.cli ?? serverCli(),
    "test-server",
    "--port",
    String(options.port ?? 0),
  ];
  if (options.host) args.push("--host", options.host);
  if (options.secret) args.push("--secret", options.secret);
  const child = spawn(process.execPath, args, {
    stdio: ["ignore", "pipe", "inherit"],
  });
  const lines = createInterface({ input: child.stdout! });
  const first = await new Promise<string>((resolve, reject) => {
    lines.once("line", resolve);
    child.once("exit", (code) =>
      reject(new Error(`test server exited with code ${code}`)),
    );
    child.once("error", reject);
  });
  const { url, secret } = JSON.parse(first) as { url: string; secret: string };
  return controlClient(url, secret, async () => {
    if (child.exitCode !== null) return;
    const exited = new Promise((r) => child.once("exit", r));
    child.kill("SIGTERM");
    await exited;
  });
}

/** Run `fn` against a fresh in-process server, always closing it. */
export async function withTestServer<T>(
  fn: (server: TestServer) => Promise<T>,
  options?: TestServerOptions,
): Promise<T> {
  const server = await startTestServer(options);
  try {
    return await fn(server);
  } finally {
    await server.close();
  }
}
