// Shared e2e fixtures: a fresh in-process server per test, and users with
// paired, keyed devices — the framework client against the real server.

import { afterEach } from "vitest";

import {
  startTestServer,
  type TestServer,
} from "@niclaslindstedt/storage-testkit";
import {
  addTestDevice,
  createTestUser,
  type TestDevice,
} from "@niclaslindstedt/storage-testkit/client";
import type { SelfHostedClient } from "@niclaslindstedt/oss-framework/storage";

const open: { close(): Promise<void> }[] = [];
const clients: SelfHostedClient[] = [];

afterEach(async () => {
  for (const c of clients.splice(0)) await c.signOut().catch(() => {});
  for (const s of open.splice(0)) await s.close();
});

export async function server(): Promise<
  TestServer & {
    server: import("@niclaslindstedt/storage-server").StorageServer;
  }
> {
  const s = await startTestServer();
  open.push(s);
  return s;
}

export async function user(
  s: TestServer,
  name: string,
  app = "e2e",
  role: "admin" | "member" | "guest" = "member",
): Promise<TestDevice> {
  const u = await createTestUser(s, name, { app, role });
  clients.push(u.client);
  return u;
}

export async function device(
  existing: SelfHostedClient,
  app = "e2e",
): Promise<SelfHostedClient> {
  const c = await addTestDevice(existing, { app });
  clients.push(c);
  return c;
}

export function track(c: SelfHostedClient): SelfHostedClient {
  clients.push(c);
  return c;
}

export async function waitFor<T>(
  fn: () =>
    Promise<T | undefined | null | false> | T | undefined | null | false,
  timeoutMs = 5000,
): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v as T;
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 25));
  }
}

export const text = (b: Uint8Array) => new TextDecoder().decode(b);
