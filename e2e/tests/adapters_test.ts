import { describe, expect, it } from "vitest";

import {
  ConflictError,
  createFileStoreAdapter,
  withLocalCache,
} from "@niclaslindstedt/oss-framework/storage";

import { device, server, user, waitFor } from "./helpers.ts";

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, v),
  };
}

describe("framework FileStore contract (drop-in for Dropbox)", () => {
  it("list / read / write / remove, and the framework's own single-file binding on top", async () => {
    const s = await server();
    const alice = await user(s, "alice");
    const ns = await alice.client.createNamespace({ name: "Notes" });
    const store = ns.fileStore({ root: "notes" });
    await store.write("a.md", "# A");
    await store.write("folder/b.md", "# B");
    expect((await store.list()).map((e) => e.path).sort()).toEqual([
      "a.md",
      "folder/b.md",
    ]);
    expect(await store.read("a.md")).toBe("# A");
    expect(await store.read("nope.md")).toBeNull();
    await store.remove("a.md");
    await store.remove("a.md"); // missing = already gone
    expect(await store.read("a.md")).toBeNull();
    await store.writeBytes(
      "photos/p.jpg",
      new Uint8Array([9, 8, 7]),
      "image/jpeg",
    );
    expect([...(await store.readBytes("photos/p.jpg"))!]).toEqual([9, 8, 7]);

    const adapter = createFileStoreAdapter(ns.fileStore(), {
      id: "selfhosted",
      label: "Self-hosted",
      retryDelaysMs: [],
    });
    const saved = await adapter.save('{"v":1}');
    expect((await adapter.load())!.text).toBe('{"v":1}');
    await expect(adapter.save('{"v":2}', "999")).rejects.toBeInstanceOf(
      ConflictError,
    );
    expect(saved.revision).toBeTruthy();
  });
});

describe("namespace StorageAdapter", () => {
  it("atomic conflicts carry the remote document; watch delivers remote changes live", async () => {
    const s = await server();
    const alice = await user(s, "alice");
    const ns = await alice.client.createNamespace({ name: "Cycle" });
    const phone = await device(alice.client);
    const laptopAdapter = ns.adapter({ fileName: "cycle.json" });
    const phoneAdapter = (await phone.namespace(ns.id)).adapter({
      fileName: "cycle.json",
    });
    expect(laptopAdapter.id).toBe("selfhosted");
    expect([...laptopAdapter.capabilities].sort()).toEqual([
      "getRevision",
      "probe",
      "watch",
    ]);
    expect(await laptopAdapter.load()).toBeNull();
    const first = await laptopAdapter.save('{"entries":{}}');
    const seen: string[] = [];
    const stop = laptopAdapter.watch!((snap) => seen.push(snap.text));
    await new Promise((r) => setTimeout(r, 100));
    const fromPhone = await phoneAdapter.save(
      '{"entries":{"2026-09-27":{"flow":2}}}',
      first.revision,
    );
    await waitFor(() => seen.length > 0);
    expect(seen[0]).toContain("2026-09-27");
    stop();
    const err = await laptopAdapter
      .save('{"entries":{"x":1}}', first.revision)
      .catch((e) => e);
    expect(err).toBeInstanceOf(ConflictError);
    expect((err as ConflictError).remote).toEqual({
      text: '{"entries":{"2026-09-27":{"flow":2}}}',
      revision: fromPhone.revision,
    });
    expect(await laptopAdapter.getRevision!()).toBe(fromPhone.revision);
    expect(await laptopAdapter.probe!()).toBe(true);
  });

  it("works under withLocalCache: offline reads serve the cache", async () => {
    const s = await server();
    const alice = await user(s, "alice");
    const ns = await alice.client.createNamespace({ name: "Meds" });
    const storage = memoryStorage();
    const adapter = withLocalCache(ns.adapter({ fileName: "meds.json" }), {
      storage,
      key: "oss:cache:selfhosted:meds",
    });
    await adapter.save('{"v":1}');
    await s.faults.offline({ path: `/v1/ns/${ns.id}/files` });
    const snap = await adapter.load();
    expect(snap).toMatchObject({ text: '{"v":1}', offline: true });
    expect(adapter.loadSync!()!.text).toBe('{"v":1}');
    expect(await ns.adapter().probe!()).toBe(true); // namespace endpoint still up
    await s.faults.clear();
    expect((await adapter.load())!.offline).toBeFalsy();
  });
});

describe("row-document adapter (meds / period / baby / time shaped)", () => {
  type Doc = {
    version: number;
    medications: Record<string, { name: string; updatedAt: string }>;
    days: Record<string, { taken: Record<string, string>; updatedAt: string }>;
  };

  it("two devices saving different rows of one document never lose each other's edits", async () => {
    const s = await server();
    const alice = await user(s, "alice");
    const ns = await alice.client.createNamespace({ name: "Me" });
    const phone = await device(alice.client);
    const opts = { rows: ["medications", "days"] };
    const laptop = ns.rowDocumentAdapter(opts);
    const mobile = (await phone.namespace(ns.id)).rowDocumentAdapter(opts);

    const base: Doc = {
      version: 6,
      medications: { m1: { name: "Levaxin", updatedAt: "t0" } },
      days: {},
    };
    await laptop.save(JSON.stringify(base));
    const loaded = JSON.parse((await mobile.load())!.text) as Doc;
    expect(loaded).toEqual(base);

    // Each device logs a different day without having seen the other's.
    const onLaptop: Doc = {
      ...base,
      days: { "2026-09-26": { taken: { "m1@08:00": "a" }, updatedAt: "t1" } },
    };
    const onPhone: Doc = {
      ...base,
      days: { "2026-09-27": { taken: { "m1@08:00": "b" }, updatedAt: "t1" } },
    };
    await laptop.save(JSON.stringify(onLaptop));
    const err = await mobile.save(JSON.stringify(onPhone)).catch((e) => e);
    // The phone's save merged in the laptop's day and tells the app so.
    expect(err).toBeInstanceOf(ConflictError);
    const merged = JSON.parse((err as ConflictError).remote.text) as Doc;
    expect(Object.keys(merged.days).sort()).toEqual([
      "2026-09-26",
      "2026-09-27",
    ]);
    // The app adopts the merged document and saves again: now it succeeds.
    await mobile.save((err as ConflictError).remote.text);
    const final = JSON.parse((await laptop.load())!.text) as Doc;
    expect(Object.keys(final.days).sort()).toEqual([
      "2026-09-26",
      "2026-09-27",
    ]);
    expect(final.medications.m1!.name).toBe("Levaxin");
  });

  it("the same day edited on both devices merges per dose", async () => {
    const s = await server();
    const alice = await user(s, "alice");
    const ns = await alice.client.createNamespace({ name: "Me" });
    const phone = await device(alice.client);
    const laptop = ns.rowDocumentAdapter({ rows: ["days"] });
    const mobile = (await phone.namespace(ns.id)).rowDocumentAdapter({
      rows: ["days"],
    });
    await laptop.save(JSON.stringify({ days: { d: { taken: {} } } }));
    await mobile.load();
    await laptop.save(
      JSON.stringify({ days: { d: { taken: { "m1@08:00": "08:02" } } } }),
    );
    const err = await mobile
      .save(JSON.stringify({ days: { d: { taken: { "m2@08:00": "08:05" } } } }))
      .catch((e) => e);
    expect(err).toBeInstanceOf(ConflictError);
    expect(JSON.parse((err as ConflictError).remote.text).days.d.taken).toEqual(
      { "m1@08:00": "08:02", "m2@08:00": "08:05" },
    );
    // Removing a row deletes it everywhere.
    await mobile.save(JSON.stringify({ days: {} }));
    expect(JSON.parse((await laptop.load())!.text)).toEqual({ days: {} });
  });
});
