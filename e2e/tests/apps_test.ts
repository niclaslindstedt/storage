// App-shaped scenarios: each mirrors how a sibling app stores data today
// (see SPEC §2), run against the real server through the framework client.

import { describe, expect, it } from "vitest";

import {
  ConflictError,
  createFileStoreAdapter,
} from "@niclaslindstedt/oss-framework/storage";

import { device, server, user } from "./helpers.ts";

describe("contacts: one document per namespace + binary photos", () => {
  it("photos live beside the document and namespaces cannot touch each other's files", async () => {
    const s = await server();
    const me = await user(s, "me", "contacts");
    const family = await me.client.createNamespace(
      { name: "Family" },
      "contacts",
    );
    const work = await me.client.createNamespace({ name: "Work" }, "contacts");
    const famStore = family.fileStore();
    const workStore = work.fileStore();
    const jpeg = new Uint8Array(200_000).map((_, i) => (i * 13) % 256);
    await famStore.writeBytes(
      "photos/ada-lovelace-3kf9-1.jpg",
      jpeg,
      "image/jpeg",
    );
    const famDoc = createFileStoreAdapter(famStore, {
      id: "selfhosted",
      label: "Self-hosted",
      fileName: "contacts-default.json",
      retryDelaysMs: [],
    });
    await famDoc.save(
      JSON.stringify({
        version: 6,
        contacts: [
          {
            id: "c1",
            name: "Ada",
            photos: [{ photoPath: "photos/ada-lovelace-3kf9-1.jpg" }],
          },
        ],
      }),
    );
    await workStore.write(
      "contacts-default.json",
      JSON.stringify({ version: 6, contacts: [] }),
    );
    // An orphan prune in "Work" sees only Work's files — the bug the Dropbox layout had cannot happen.
    const workFiles = (await workStore.list()).map((e) => e.path);
    expect(workFiles).toEqual(["contacts-default.json"]);
    for (const f of workFiles.filter((p) => p.startsWith("photos/")))
      await workStore.remove(f);
    expect(
      [...(await famStore.readBytes("photos/ada-lovelace-3kf9-1.jpg"))!].slice(
        0,
        5,
      ),
    ).toEqual([...jpeg.slice(0, 5)]);
    expect(JSON.parse((await famDoc.load())!.text).contacts[0].name).toBe(
      "Ada",
    );
  });
});

describe("notes: one file per note, renames, incremental listing", () => {
  it("revisions in the listing let a client re-download only what changed", async () => {
    const s = await server();
    const me = await user(s, "me", "notes");
    const ns = await me.client.createNamespace({ name: "Default" }, "notes");
    const phone = await device(me.client, "notes");
    const store = ns.fileStore({ root: "notes" });
    for (let i = 0; i < 25; i++)
      await store.write(`note-${i}.md`, `---\nid: ${i}\n---\n# Note ${i}`);
    const first = new Map((await store.list()).map((e) => [e.path, e.rev]));
    expect(first.size).toBe(25);
    const phoneStore = (await phone.namespace(ns.id)).fileStore({
      root: "notes",
    });
    await phoneStore.write("note-3.md", "# edited on phone");
    const second = await store.list();
    const changed = second
      .filter((e) => first.get(e.path) !== e.rev)
      .map((e) => e.path);
    expect(changed).toEqual(["note-3.md"]);
    // A title change renames the file; history follows the file.
    await ns.files.move("notes/note-3.md", "notes/groceries-1a2b3c.md");
    expect(
      (await ns.files.history("notes/groceries-1a2b3c.md")).length,
    ).toBeGreaterThanOrEqual(2);
    // The change feed tells the phone exactly what happened.
    const feed = await (await phone.namespace(ns.id)).changes(0);
    const moves = feed.changes.filter(
      (c) =>
        (c.kind === "file" && c.path.includes("note-3")) ||
        (c.kind === "file" && c.path.includes("groceries")),
    );
    expect(moves.map((c) => c.kind === "file" && [c.path, c.deleted])).toEqual(
      expect.arrayContaining([
        ["notes/note-3.md", true],
        ["notes/groceries-1a2b3c.md", false],
      ]),
    );
  });
});

describe("calendar: one document per calendar, the calendar list syncs", () => {
  it("namespaces are the calendar registry — every device sees the same list and names", async () => {
    const s = await server();
    const me = await user(s, "me", "calendar");
    const phone = await device(me.client, "calendar");
    const home = await me.client.createNamespace(
      { name: "Home", glyph: "house", color: "#4ea1ff" },
      "calendar",
    );
    await me.client.createNamespace({ name: "Work" }, "calendar");
    await me.client.createNamespace({ name: "Not a calendar" }, "notes");
    const list = await phone.namespaces("calendar");
    expect(list.map((n) => n.meta.name)).toEqual(["Home", "Work"]);
    expect(list[0]!.meta).toEqual({
      name: "Home",
      glyph: "house",
      color: "#4ea1ff",
    });
    await (
      await phone.namespace(home.id)
    ).updateMeta({ name: "Home 🏡", glyph: "house" });
    expect((await me.client.namespace(home.id)).meta.name).toBe("Home 🏡");
    // The document itself: remote-wins no longer drops edits — conflicts carry both sides.
    const a = home.adapter({ fileName: "calendar.json" });
    const b = (await phone.namespace(home.id)).adapter({
      fileName: "calendar.json",
    });
    const v1 = await a.save(JSON.stringify({ version: 1, entries: {} }));
    await b.save(
      JSON.stringify({
        version: 1,
        entries: { "2026-10-01": "Dentist 09:00" },
      }),
      v1.revision,
    );
    const err = await a
      .save(
        JSON.stringify({ version: 1, entries: { "2026-10-02": "Dinner" } }),
        v1.revision,
      )
      .catch((e) => e);
    expect(err).toBeInstanceOf(ConflictError);
    const remote = JSON.parse((err as ConflictError).remote.text);
    const merged = {
      version: 1,
      entries: { ...remote.entries, "2026-10-02": "Dinner" },
    };
    await a.save(
      JSON.stringify(merged),
      (err as ConflictError).remote.revision,
    );
    expect(JSON.parse((await b.load())!.text).entries).toEqual({
      "2026-10-01": "Dentist 09:00",
      "2026-10-02": "Dinner",
    });
  });
});

describe("quotas", () => {
  it("a full quota is a typed error, not a silent failure", async () => {
    const s = await server();
    const seeded = await s.createAccount("small", { quotaBytes: 50_000 });
    const { createSelfHostedClient, createMemoryKeyVault, QuotaExceededError } =
      await import("@niclaslindstedt/oss-framework/storage");
    const c = createSelfHostedClient({
      app: "x",
      vault: createMemoryKeyVault(),
    });
    await c.pair(seeded.pairingUri, { name: "d" });
    await c.createAccountKeys();
    const ns = await c.createNamespace({ name: "N" });
    await ns.files.write("small", new Uint8Array(10_000));
    await expect(
      ns.files.write("big", new Uint8Array(60_000)),
    ).rejects.toBeInstanceOf(QuotaExceededError);
    await c.signOut();
  });
});
