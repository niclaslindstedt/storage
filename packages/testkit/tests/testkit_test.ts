import { existsSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  startTestServer,
  startTestServerProcess,
  type TestServer,
  withTestServer,
} from "../src/index.ts";

const servers: TestServer[] = [];
afterEach(async () => {
  for (const s of servers.splice(0)) await s.close();
});

describe("startTestServer (in-process)", () => {
  it("seeds accounts with pairing codes", async () => {
    const s = await startTestServer();
    servers.push(s);
    const alice = await s.createAccount("alice", { role: "admin" });
    expect(alice.account).toMatchObject({ name: "alice", role: "admin" });
    expect(alice.pairingUri).toMatch(
      new RegExp(`^oss-storage://pair\\?v=1&s=${encodeURIComponent(s.url)}`),
    );
    const again = await s.pairingFor(alice.account.id);
    expect(again.pairingCode).not.toBe(alice.pairingCode);
  });

  it("injects faults and clears them", async () => {
    const s = await startTestServer();
    servers.push(s);
    await s.faults.status(503, { path: "/v1/info", times: 1 });
    expect((await fetch(`${s.url}/v1/info`)).status).toBe(503);
    expect((await fetch(`${s.url}/v1/info`)).status).toBe(200);
    await s.faults.status(429, { path: "/v1/info", retryAfter: 2 });
    const r = await fetch(`${s.url}/v1/info`);
    expect(r.status).toBe(429);
    expect(r.headers.get("retry-after")).toBe("2");
    await s.faults.clear();
    await s.faults.offline({ path: "/v1/info", times: 1 });
    await expect(fetch(`${s.url}/v1/info`)).rejects.toThrow();
    expect((await fetch(`${s.url}/v1/info`)).status).toBe(200);
  });

  it("moves the clock, snapshots, restores and resets", async () => {
    const s = await startTestServer();
    servers.push(s);
    const t0 = (await (await fetch(`${s.url}/v1/info`)).json()).time as number;
    await s.clock.advance(3_600_000);
    const t1 = (await (await fetch(`${s.url}/v1/info`)).json()).time as number;
    expect(t1 - t0).toBeGreaterThanOrEqual(3_600_000);
    await s.clock.reset();
    const snap = await s.snapshot();
    await s.createAccount("bob");
    await s.restore(snap);
    await expect(s.createAccount("bob")).resolves.toBeTruthy(); // bob was gone again
    await s.reset();
    await expect(s.createAccount("bob")).resolves.toBeTruthy();
    expect(await s.retention()).toMatchObject({ trashPurged: 0 });
  });

  it("withTestServer always closes", async () => {
    let url = "";
    await withTestServer(async (s) => {
      url = s.url;
      expect((await fetch(`${s.url}/v1/info`)).ok).toBe(true);
    });
    await expect(fetch(`${url}/v1/info`)).rejects.toThrow();
  });
});

const cli = join(__dirname, "..", "..", "server", "dist", "cli.js");

describe.skipIf(!existsSync(cli))(
  "startTestServerProcess (child process)",
  () => {
    it("runs the CLI test server and controls it over HTTP", async () => {
      const s = await startTestServerProcess({ cli });
      servers.push(s);
      const a = await s.createAccount("carol");
      expect(a.pairingUri).toContain("oss-storage://pair");
      await s.faults.status(500, { path: "/v1/info", times: 1 });
      expect((await fetch(`${s.url}/v1/info`)).status).toBe(500);
    });
  },
);
