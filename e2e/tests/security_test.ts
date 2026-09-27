import { describe, expect, it } from "vitest";

import {
  DecryptError,
  RollbackError,
} from "@niclaslindstedt/oss-framework/storage";

import { server, user } from "./helpers.ts";

describe("what a hostile server can and cannot do", () => {
  it("swapping two files' blobs is detected, not silently served", async () => {
    const s = await server();
    const alice = await user(s, "alice");
    const ns = await alice.client.createNamespace({ name: "Me" });
    await ns.files.write("a.txt", "AAAA");
    await ns.files.write("b.txt", "BBBB");
    const db = s.server.ctx.db;
    const rows = db.all<{ path: string; blob_hash: string }>(
      "SELECT path, blob_hash FROM files WHERE namespace_id = ? ORDER BY rowid",
      ns.id,
    );
    db.run(
      "UPDATE files SET blob_hash = ? WHERE namespace_id = ? AND path = ?",
      rows[1]!.blob_hash,
      ns.id,
      rows[0]!.path,
    );
    await expect(ns.files.read("a.txt")).rejects.toBeInstanceOf(DecryptError);
  });

  it("swapping two rows' values is detected", async () => {
    const s = await server();
    const alice = await user(s, "alice");
    const ns = await alice.client.createNamespace({ name: "Me" });
    const r = ns.records<string>("c");
    await r.put("a", "value-a");
    await r.put("b", "value-b");
    const db = s.server.ctx.db;
    const rows = db.all<{ key: string; value: Uint8Array }>(
      "SELECT key, value FROM records WHERE namespace_id = ? ORDER BY rowid",
      ns.id,
    );
    db.run(
      "UPDATE records SET value = ? WHERE namespace_id = ? AND key = ?",
      rows[1]!.value,
      ns.id,
      rows[0]!.key,
    );
    await expect(r.get("a")).rejects.toBeInstanceOf(DecryptError);
  });

  it("rolling the server back to an older state is detected", async () => {
    const s = await server();
    const alice = await user(s, "alice");
    const ns = await alice.client.createNamespace({ name: "Me" });
    const old = await s.snapshot();
    await ns.records("c").put("k", 1);
    await ns.records("c").put("k", 2);
    await s.restore(old);
    await expect(alice.client.namespaces()).rejects.toBeInstanceOf(
      RollbackError,
    );
  });

  it("the server never sees a key: its database and blobs hold no key material in the clear", async () => {
    const s = await server();
    const alice = await user(s, "alice");
    const ns = await alice.client.createNamespace({ name: "Me" });
    await ns.files.write("x", "secret payload");
    const snap = JSON.stringify(await s.snapshot());
    expect(snap).not.toContain("secret payload");
    // The recovery key never left the device.
    expect(snap).not.toContain(alice.recoveryKey!.replaceAll("-", ""));
  });
});
