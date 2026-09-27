// The admin console against a real running server and the framework client:
// what an operator does in the browser has the effect a device sees.

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  AuthError,
  createMemoryKeyVault,
  createSelfHostedClient,
  type SelfHostedClient,
} from "@niclaslindstedt/oss-framework/storage";
import {
  createMemoryLogger,
  resolveConfig,
} from "@niclaslindstedt/storage-server";

// The production runtime (the console lives there, not in the embeddable API).
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
  console: (path: string, init?: RequestInit) => Promise<Response>;
}> {
  const dataDir = mkdtempSync(join(tmpdir(), "storage-admin-e2e-"));
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
    console: (path, init = {}) =>
      fetch(server.adminUrl + path, {
        ...init,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          ...init.headers,
        },
      }),
  };
}

async function pairFromConsole(
  c: Awaited<ReturnType<typeof running>>["console"],
  name: string,
  role = "admin",
): Promise<SelfHostedClient> {
  const res = await c("/api/pairing", {
    method: "POST",
    body: JSON.stringify({ name, role }),
  });
  expect(res.status).toBe(200);
  const { payload } = (await res.json()) as { payload: string };
  const client = createSelfHostedClient({
    app: "meds",
    vault: createMemoryKeyVault(),
  });
  cleanups.push(() => client.signOut().catch(() => {}));
  await client.pair(payload, { name: `${name}'s phone`, platform: "ios" });
  await client.createAccountKeys();
  return client;
}

describe("admin console, end to end", () => {
  it("pairs a device with a console QR payload; the console sees it, its namespace and its traffic", async () => {
    const { console: c } = await running();
    const mum = await pairFromConsole(c, "mum");
    const ns = await mum.createNamespace({ name: "Mum's medication" });
    await ns.records("medications").put("m1", { name: "Levaxin" });

    const devices = (await (await c("/api/devices")).json()) as {
      name: string;
      account: string;
      state: string;
    }[];
    expect(devices).toEqual([
      expect.objectContaining({
        name: "mum's phone",
        account: "mum",
        state: "active",
      }),
    ]);

    const namespaces = (await (await c("/api/namespaces")).json()) as {
      app: string;
      owner: string;
      members: { name: string; role: string }[];
    }[];
    expect(namespaces).toEqual([
      expect.objectContaining({
        app: "meds",
        owner: "mum",
        members: [{ name: "mum", role: "owner" }],
      }),
    ]);
    // The console never learns the namespace's name or the record.
    const everything = JSON.stringify(
      await Promise.all(
        [
          "/api/overview",
          "/api/namespaces",
          "/api/logs",
          "/api/audit",
          "/api/diagnostics",
        ].map(async (p) => (await c(p)).text()),
      ),
    );
    expect(everything).not.toContain("Mum's medication");
    expect(everything).not.toContain("Levaxin");
    expect(everything).not.toContain("medications");

    const metrics = (await (await c("/api/metrics")).json()) as {
      routes: { route: string; count: number }[];
    };
    expect(metrics.routes.map((r) => r.route)).toEqual(
      expect.arrayContaining(["/v1/auth/challenge", "/v1/namespaces"]),
    );
  });

  it("revoking a device in the console locks it out at once", async () => {
    const { console: c } = await running();
    const mum = await pairFromConsole(c, "mum");
    await mum.createNamespace({ name: "x" });
    const [dev] = (await (await c("/api/devices")).json()) as { id: string }[];
    const revoke = await c(`/api/devices/${dev!.id}`, { method: "DELETE" });
    expect(revoke.status).toBe(200);
    await expect(mum.namespaces()).rejects.toBeInstanceOf(AuthError);

    const audit = (await (
      await c("/api/audit?action=device.revoke")
    ).json()) as {
      entries: { actor: string }[];
    };
    expect(audit.entries[0]!.actor).toBe("admin-console");
  });

  it("disabling an account signs its devices out; enabling lets them back in", async () => {
    const { console: c } = await running();
    await pairFromConsole(c, "root");
    const dad = await pairFromConsole(c, "dad", "member");
    const accounts = (await (await c("/api/accounts")).json()) as {
      id: string;
      name: string;
    }[];
    const id = accounts.find((a) => a.name === "dad")!.id;
    await c(`/api/accounts/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ disabled: true }),
    });
    await expect(dad.namespaces()).rejects.toBeInstanceOf(AuthError);
    await c(`/api/accounts/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ disabled: false }),
    });
    await expect(dad.namespaces()).resolves.toEqual([]);
  });
});
