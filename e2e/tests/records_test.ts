import { describe, expect, it } from "vitest";

import { RowConflictError } from "@niclaslindstedt/oss-framework/storage";

import { device, server, user } from "./helpers.ts";

type Med = {
  name: string;
  dose: string;
  schedule: string[];
  updatedAt: string;
};

describe("rows (key-value)", () => {
  it("put / get / list / delete with per-row revisions and conflicts", async () => {
    const s = await server();
    const alice = await user(s, "alice");
    const ns = await alice.client.createNamespace({ name: "Meds" });
    const meds = ns.records<Med>("medications");
    const r1 = await meds.put("ibu", {
      name: "Ibuprofen",
      dose: "200mg",
      schedule: ["08:00"],
      updatedAt: "t1",
    });
    await meds.put("para", {
      name: "Paracetamol",
      dose: "500mg",
      schedule: [],
      updatedAt: "t1",
    });
    expect((await meds.get("ibu"))!.value.dose).toBe("200mg");
    expect((await meds.list()).map((r) => r.key)).toEqual(["ibu", "para"]);
    await meds.put(
      "ibu",
      {
        name: "Ibuprofen",
        dose: "400mg",
        schedule: ["08:00"],
        updatedAt: "t2",
      },
      { ifRev: r1 },
    );
    const err = await meds
      .put(
        "ibu",
        { name: "X", dose: "1", schedule: [], updatedAt: "t3" },
        { ifRev: r1 },
      )
      .catch((e) => e);
    expect(err).toBeInstanceOf(RowConflictError);
    expect((err as RowConflictError<Med>).current).toMatchObject({
      key: "ibu",
      value: { dose: "400mg" },
    });
    await meds.delete("para");
    expect(await meds.get("para")).toBeNull();
    const withTombstones = await meds.list({ includeDeleted: true });
    expect(withTombstones.find((r) => r.key === "para")).toMatchObject({
      deleted: true,
    });
    const snap = JSON.stringify(await s.snapshot());
    for (const plain of [
      "Ibuprofen",
      "Paracetamol",
      "medications",
      "400mg",
      // A leaked key would sit in the dump as its own JSON string. Bare, three
      // letters turn up by chance in a few kilobytes of base64 now and then.
      JSON.stringify("ibu"),
    ])
      expect(snap).not.toContain(plain);
  });
});

describe("RecordStore: row-level sync between devices", () => {
  it("edits to different fields of the same row on two devices both survive", async () => {
    const s = await server();
    const alice = await user(s, "alice");
    const ns = await alice.client.createNamespace({ name: "Meds" });
    const phone = await device(alice.client);
    const a = ns.recordStore<Med>("medications");
    const b = (await phone.namespace(ns.id)).recordStore<Med>("medications");
    a.set("ibu", {
      name: "Ibuprofen",
      dose: "200mg",
      schedule: ["08:00"],
      updatedAt: "2026-09-27T08:00:00Z",
    });
    await a.sync();
    await b.sync();
    expect(b.get("ibu")!.dose).toBe("200mg");

    // Both edit offline-style (without syncing in between).
    a.set("ibu", {
      ...a.get("ibu")!,
      dose: "400mg",
      updatedAt: "2026-09-27T09:00:00Z",
    });
    b.set("ibu", {
      ...b.get("ibu")!,
      schedule: ["08:00", "20:00"],
      updatedAt: "2026-09-27T09:05:00Z",
    });
    await a.sync();
    const r = await b.sync();
    expect(r.merged).toBe(1);
    await a.sync();
    const expected = {
      name: "Ibuprofen",
      dose: "400mg",
      schedule: ["08:00", "20:00"],
    };
    expect(a.get("ibu")).toMatchObject(expected);
    expect(b.get("ibu")).toMatchObject(expected);
  });

  it("true conflicts go to the newer updatedAt, the same on every device", async () => {
    const s = await server();
    const alice = await user(s, "alice");
    const ns = await alice.client.createNamespace({ name: "Meds" });
    const phone = await device(alice.client);
    const a = ns.recordStore<Med>("m");
    const b = (await phone.namespace(ns.id)).recordStore<Med>("m");
    a.set("x", {
      name: "X",
      dose: "1",
      schedule: [],
      updatedAt: "2026-01-01T00:00:00Z",
    });
    await a.sync();
    await b.sync();
    a.set("x", {
      ...a.get("x")!,
      dose: "from-a",
      updatedAt: "2026-01-01T10:00:00Z",
    });
    b.set("x", {
      ...b.get("x")!,
      dose: "from-b",
      updatedAt: "2026-01-01T11:00:00Z",
    });
    await a.sync();
    await b.sync();
    await a.sync();
    expect(a.get("x")!.dose).toBe("from-b");
    expect(b.get("x")!.dose).toBe("from-b");
  });

  it("deletions sync as tombstones and do not come back", async () => {
    const s = await server();
    const alice = await user(s, "alice");
    const ns = await alice.client.createNamespace({ name: "Days" });
    const phone = await device(alice.client);
    const a = ns.recordStore<{ taken: string[] }>("days");
    const b = (await phone.namespace(ns.id)).recordStore<{ taken: string[] }>(
      "days",
    );
    a.set("2026-09-26", { taken: ["m1"] });
    a.set("2026-09-27", { taken: ["m1"] });
    await a.sync();
    await b.sync();
    b.delete("2026-09-26");
    await b.sync();
    // A device that still has the old day and edits something else must not resurrect it.
    a.set("2026-09-27", { taken: ["m1", "m2"] });
    await a.sync();
    expect(a.has("2026-09-26")).toBe(false);
    await b.sync();
    expect(b.get("2026-09-27")).toEqual({ taken: ["m1", "m2"] });
  });

  it("an edit beats a concurrent delete", async () => {
    const s = await server();
    const alice = await user(s, "alice");
    const ns = await alice.client.createNamespace({ name: "Days" });
    const phone = await device(alice.client);
    const a = ns.recordStore<{ v: number }>("c");
    const b = (await phone.namespace(ns.id)).recordStore<{ v: number }>("c");
    a.set("k", { v: 1 });
    await a.sync();
    await b.sync();
    a.delete("k");
    b.set("k", { v: 2 });
    await a.sync();
    await b.sync();
    await a.sync();
    expect(a.get("k")).toEqual({ v: 2 });
    expect(b.get("k")).toEqual({ v: 2 });
  });

  it("survives transient failures and an expired change cursor", async () => {
    const s = await server();
    const alice = await user(s, "alice");
    const ns = await alice.client.createNamespace({ name: "C" });
    const store = ns.recordStore<number>("n");
    store.set("a", 1);
    await s.faults.status(503, { path: `/v1/ns/${ns.id}/batch`, times: 1 });
    await expect(store.sync()).rejects.toThrow();
    expect(store.pending()).toEqual(["a"]);
    await store.sync();
    expect(store.pending()).toEqual([]);
    // Purge tombstones past the horizon, then sync from an old cursor → 410 → resync.
    const other = ns.records<number>("n");
    await other.put("b", 2);
    await other.delete("b");
    await s.clock.advance(91 * 24 * 3600_000);
    await s.retention();
    await other.put("c", 3);
    const r = await store.sync();
    expect(r.pulled).toBeGreaterThan(0);
    expect(store.entries().sort()).toEqual([
      ["a", 1],
      ["c", 3],
    ]);
  });
});
