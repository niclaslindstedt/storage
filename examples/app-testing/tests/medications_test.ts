// How an app's own tests use the testkit: a real server per test, a paired
// client in one call, and controls a hosted backend never offers — faults,
// a movable clock, and snapshots.

import { afterEach, describe, expect, it } from "vitest";

import { RollbackError } from "@niclaslindstedt/oss-framework/storage";
import {
  startTestServer,
  type TestServer,
} from "@niclaslindstedt/storage-testkit";
import { createTestUser } from "@niclaslindstedt/storage-testkit/client";

let server: TestServer;
afterEach(() => server?.close());

describe("medication list on the self-hosted backend", () => {
  it("survives a flaky network with a retry", async () => {
    server = await startTestServer();
    const { client } = await createTestUser(server, "mum", { app: "meds" });
    const ns = await client.createNamespace({ name: "Meds" });
    const store = ns.recordStore<{ name: string }>("medications");

    // The next write fails with 503; the store keeps the edit pending.
    await server.faults.status(503, {
      path: `/v1/ns/${ns.id}/batch`,
      times: 1,
    });
    store.set("m1", { name: "Levaxin" });
    await expect(store.sync()).rejects.toThrow();
    const { pushed } = await store.sync();
    expect(pushed).toBe(1);
    await client.signOut();
  });

  it("refuses a server that was rolled back to an older state", async () => {
    server = await startTestServer();
    const { client } = await createTestUser(server, "mum", { app: "meds" });
    const ns = await client.createNamespace({ name: "Meds" });
    await ns.records("medications").put("m1", { name: "Levaxin" });
    const before = await server.snapshot();

    await ns.records("medications").put("m2", { name: "Alvedon" });
    // A hoster (or a stale backup) replays old state: devices notice, because
    // they remember the highest sequence number they have seen.
    await server.restore(before);
    await expect(ns.records("medications").list()).rejects.toBeInstanceOf(
      RollbackError,
    );
    await client.signOut();
  });
});
