// Storage Remote's server side end to end (SPEC §11.2): the operator pairs
// an admin device from the local console, the framework client on that
// device runs the console remotely and keeps files, and the operator can
// take the access away again — against the production runtime.

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, expect, it } from "vitest";

import {
  createMemoryKeyVault,
  createSelfHostedClient,
  type SelfHostedClient,
} from "@niclaslindstedt/oss-framework/storage";
import {
  createMemoryLogger,
  resolveConfig,
} from "@niclaslindstedt/storage-server";

import {
  type RunningServer,
  startServer,
} from "../../packages/server/src/serve.ts";

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

async function running(): Promise<{
  server: RunningServer;
  local: <T>(path: string, init?: RequestInit) => Promise<T>;
}> {
  const dataDir = mkdtempSync(join(tmpdir(), "storage-remote-e2e-"));
  cleanups.push(() => rmSync(dataDir, { recursive: true, force: true }));
  const server = await startServer(
    resolveConfig({
      name: "home",
      dataDir,
      tls: { mode: "off" },
      listen: { host: "127.0.0.1", port: 0, adminPort: 0 },
    }),
    { log: createMemoryLogger() },
  );
  cleanups.push(() => server.close());
  const token = readFileSync(join(dataDir, "admin.token"), "utf8").trim();
  return {
    server,
    async local<T>(path: string, init: RequestInit = {}) {
      const res = await fetch(server.adminUrl + path, {
        ...init,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          ...init.headers,
        },
      });
      expect(res.status, await res.clone().text()).toBeLessThan(300);
      return (await res.json()) as T;
    },
  };
}

function phone(): SelfHostedClient {
  const c = createSelfHostedClient({
    vault: createMemoryKeyVault("bytes"),
    app: "drive",
  });
  cleanups.push(() => c.signOut().catch(() => {}));
  return c;
}

it("an admin device paired at the machine runs the server and keeps files", async () => {
  const { local } = await running();
  const owner = await local<{ id: string }>("/api/accounts", {
    method: "POST",
    body: JSON.stringify({ name: "owner", role: "admin" }),
  });
  const { payload } = await local<{ payload: string }>(
    `/api/accounts/${owner.id}/pairing`,
    { method: "POST", body: JSON.stringify({ console: true }) },
  );

  const app = phone();
  expect(await app.pair(payload, { name: "Pixel", platform: "android" })).toBe(
    "needs-keys",
  );
  await app.createAccountKeys();
  expect(
    (await app.transport.json<{ console: boolean }>("GET", "/v1/me")).console,
  ).toBe(true);

  // The console, remotely: overview, and adding a user with a pairing QR.
  const overview = await app.transport.json<{
    server: { name: string };
    counts: { accounts: number };
  }>("GET", "/v1/console/overview");
  expect(overview.server.name).toBe("home");
  const grandma = await app.transport.json<{ id: string }>(
    "POST",
    "/v1/console/accounts",
    { json: { name: "grandma", role: "member" } },
  );
  const pairing = await app.transport.json<{ payload: string }>(
    "POST",
    `/v1/console/accounts/${grandma.id}/pairing`,
    { json: {} },
  );
  expect(pairing.payload).toMatch(/^oss-storage:\/\/pair\?/);

  // Files: the drive app's namespace, sealed on the device.
  const folder = await app.createNamespace({ name: "Documents" });
  const bytes = new TextEncoder().encode("the deed to the house");
  await folder.files.write("Legal/deed.pdf", bytes, {
    mime: "application/pdf",
  });
  const back = await folder.files.read("Legal/deed.pdf");
  expect(new TextDecoder().decode(back!.bytes)).toBe("the deed to the house");
  const listed = await app.transport.json<{ id: string; app: string }[]>(
    "GET",
    "/v1/console/namespaces",
  );
  expect(listed).toEqual([expect.objectContaining({ app: "drive" })]);
  expect(JSON.stringify(listed)).not.toContain("Documents");

  // The local console sees who did it, and takes the access away.
  const audit = await local<{ entries: { actor: string; action: string }[] }>(
    "/api/audit?action=account.create",
  );
  expect(audit.entries[0]!.actor).toBe(app.session!.deviceId);
  await local(`/api/devices/${app.session!.deviceId}`, {
    method: "PATCH",
    body: JSON.stringify({ console: false }),
  });
  await expect(
    app.transport.json("GET", "/v1/console/overview"),
  ).rejects.toThrow(/admin device/);
  // Its files are still its own.
  expect((await folder.files.list()).map((f) => f.path)).toEqual([
    "Legal/deed.pdf",
  ]);
});

it("the device API never mints an admin device, even for an admin device", async () => {
  const { local } = await running();
  const owner = await local<{ id: string }>("/api/accounts", {
    method: "POST",
    body: JSON.stringify({ name: "owner", role: "admin" }),
  });
  const { payload } = await local<{ payload: string }>(
    `/api/accounts/${owner.id}/pairing`,
    { method: "POST", body: JSON.stringify({ console: true }) },
  );
  const app = phone();
  await app.pair(payload, { name: "Pixel" });
  await expect(
    app.transport.json("POST", `/v1/console/accounts/${owner.id}/pairing`, {
      json: { console: true },
    }),
  ).rejects.toThrow(/local console/);
  await expect(
    app.transport.json("POST", "/v1/pairings", {
      json: { accountId: owner.id, console: true },
    }),
  ).rejects.toThrow(/local console/);
});
