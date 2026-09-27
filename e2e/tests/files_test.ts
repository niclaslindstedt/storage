import { describe, expect, it } from "vitest";

import {
  FileConflictError,
  StorageForbiddenError,
} from "@niclaslindstedt/oss-framework/storage";

import { device, server, text, user } from "./helpers.ts";

describe("encrypted files", () => {
  it("writes, reads, lists, stats; paths and contents are opaque to the server", async () => {
    const s = await server();
    const alice = await user(s, "alice");
    const ns = await alice.client.createNamespace({ name: "Journal" });
    await ns.files.write(
      "notes/Blodtryck september.md",
      "# 128/82 — mått efter promenad",
      { mime: "text/markdown", tags: ["health"] },
    );
    await ns.files.write("notes/sub/b.md", "b");
    await ns.files.write("root.json", "{}");
    const list = await ns.files.list();
    expect(list.map((f) => f.path)).toEqual([
      "notes/Blodtryck september.md",
      "notes/sub/b.md",
      "root.json",
    ]);
    expect(list[0]).toMatchObject({
      mime: "text/markdown",
      tags: ["health"],
      size: new TextEncoder().encode("# 128/82 — mått efter promenad").length,
    });
    expect((await ns.files.list("notes")).map((f) => f.path)).toEqual([
      "notes/Blodtryck september.md",
      "notes/sub/b.md",
    ]);
    expect(
      (await ns.files.readText("notes/Blodtryck september.md"))!.text,
    ).toBe("# 128/82 — mått efter promenad");
    expect(await ns.files.read("missing.md")).toBeNull();
    expect(await ns.files.stat("missing.md")).toBeNull();

    // Nothing user-authored is visible on the server.
    const snap = JSON.stringify(await s.snapshot());
    for (const secret of [
      "Blodtryck",
      "september",
      "128/82",
      "promenad",
      "notes",
      "Journal",
      "health",
      "text/markdown",
    ]) {
      expect(snap).not.toContain(secret);
    }
  });

  it("compare-and-swap: a stale write throws FileConflictError with the current version", async () => {
    const s = await server();
    const alice = await user(s, "alice");
    const ns = await alice.client.createNamespace({ name: "Me" });
    const phone = await device(alice.client);
    const nsPhone = await phone.namespace(ns.id);
    const v1 = await ns.files.write("doc.json", "v1");
    const v2 = await nsPhone.files.write("doc.json", "v2 from phone", {
      ifRev: v1.rev,
    });
    const err = await ns.files
      .write("doc.json", "v2 from laptop", { ifRev: v1.rev })
      .catch((e) => e);
    expect(err).toBeInstanceOf(FileConflictError);
    expect((err as FileConflictError).current).toMatchObject({
      rev: v2.rev,
      path: "doc.json",
    });
    await expect(
      ns.files.write("doc.json", "x", { ifAbsent: true }),
    ).rejects.toBeInstanceOf(FileConflictError);
    expect((await ns.files.readText("doc.json"))!.text).toBe("v2 from phone");
  });

  it("moves keep identity and history; copies are new files", async () => {
    const s = await server();
    const alice = await user(s, "alice");
    const ns = await alice.client.createNamespace({ name: "Notes" });
    await ns.files.write("a.md", "one");
    await ns.files.write("a.md", "two");
    const moved = await ns.files.move("a.md", "folder/renamed.md");
    expect(await ns.files.stat("a.md")).toBeNull();
    expect((await ns.files.readText("folder/renamed.md"))!.text).toBe("two");
    expect((await ns.files.history("folder/renamed.md")).length).toBe(3);
    const copy = await ns.files.copy("folder/renamed.md", "copy.md");
    expect(copy.fileId).not.toBe(moved.fileId);
    expect((await ns.files.readText("copy.md"))!.text).toBe("two");
    await expect(
      ns.files.move("copy.md", "folder/renamed.md"),
    ).rejects.toBeInstanceOf(FileConflictError);
  });

  it("history: read and restore earlier versions", async () => {
    const s = await server();
    const alice = await user(s, "alice");
    const ns = await alice.client.createNamespace({ name: "Me" });
    await ns.files.write("f.txt", "first");
    await ns.files.write("f.txt", "second");
    await ns.files.write("f.txt", "third");
    const hist = await ns.files.history("f.txt");
    expect(hist).toHaveLength(3);
    expect(text(await ns.files.readRevision("f.txt", hist[2]!.rev))).toBe(
      "first",
    );
    await ns.files.restore("f.txt", hist[2]!.rev);
    expect((await ns.files.readText("f.txt"))!.text).toBe("first");
  });

  it("trash: delete, list, restore and purge", async () => {
    const s = await server();
    const alice = await user(s, "alice");
    const ns = await alice.client.createNamespace({ name: "Me" });
    const f = await ns.files.write("photo.jpg", new Uint8Array([1, 2, 3]), {
      mime: "image/jpeg",
    });
    expect(await ns.files.delete("photo.jpg")).toBe(true);
    expect(await ns.files.delete("photo.jpg")).toBe(false);
    const trash = await ns.files.trash();
    expect(trash).toMatchObject([
      { fileId: f.fileId, path: "photo.jpg", size: 3 },
    ]);
    await ns.files.restoreTrash(f.fileId);
    expect([...(await ns.files.read("photo.jpg"))!.bytes]).toEqual([1, 2, 3]);
    await ns.files.delete("photo.jpg");
    await ns.files.purgeTrash(f.fileId);
    expect(await ns.files.trash()).toEqual([]);
  });

  it("large files go through multi-part upload transparently", async () => {
    const s = await server();
    const alice = await user(s, "alice");
    const ns = await alice.client.createNamespace({ name: "Media" });
    const big = new Uint8Array(9 * 1024 * 1024 + 123);
    for (let i = 0; i < big.length; i += 4096) big[i] = i % 251;
    await ns.files.write("video.bin", big);
    const back = (await ns.files.read("video.bin"))!.bytes;
    expect(back.length).toBe(big.length);
    expect(back[4096 * 7]).toBe(big[4096 * 7]);
  });

  it("viewers cannot write", async () => {
    const s = await server();
    const alice = await user(s, "alice");
    const bob = await user(s, "bob");
    const ns = await alice.client.createNamespace({ name: "Shared" });
    const { payload } = await ns.invite({ role: "viewer" });
    const { namespace } = await bob.client.acceptInvite(payload);
    await ns.files.write("x", "from alice");
    expect((await namespace.files.readText("x"))!.text).toBe("from alice");
    await expect(namespace.files.write("y", "from bob")).rejects.toBeInstanceOf(
      StorageForbiddenError,
    );
  });
});
