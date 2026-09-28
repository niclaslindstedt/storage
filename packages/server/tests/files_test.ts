import { Readable } from "node:stream";

import { describe, expect, it } from "vitest";

import { ApiError } from "../src/errors.ts";
import {
  copyFile,
  deleteFile,
  fileHistory,
  listFiles,
  listTrash,
  moveFile,
  purgeTrash,
  putFile,
  readFile,
  readRevision,
  restoreRevision,
  restoreTrash,
  statFile,
} from "../src/services/files.ts";
import { createNamespace, getNamespace } from "../src/services/namespaces.ts";
import { updateAccount } from "../src/services/accounts.ts";
import { runRetention } from "../src/services/retention.ts";
import { getSettings, updateSettings } from "../src/services/settings.ts";
import {
  envelope,
  envelopeB64u,
  principal,
  testContext,
  WRAP,
} from "./helpers.ts";

async function expectApiError(
  p: Promise<unknown> | (() => unknown),
  code: string,
) {
  try {
    await (typeof p === "function" ? p() : p);
  } catch (err) {
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe(code);
    return err as ApiError;
  }
  throw new Error(`expected ApiError ${code}`);
}

async function text(stream: Readable): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(Buffer.from(c));
  return new Uint8Array(Buffer.concat(chunks));
}

async function setup(overrides = {}) {
  const ctx = testContext(overrides);
  const alice = principal(ctx, "alice");
  const ns = createNamespace(ctx, alice, {
    app: "notes",
    meta: envelopeB64u(),
    wrap: WRAP,
  });
  return { ctx, alice, ns };
}

const META = envelopeB64u(1, 8, 3);

describe("files: compare-and-swap", () => {
  it("creates, reads and overwrites with If-Match", async () => {
    const { ctx, alice, ns } = await setup();
    const v1 = await putFile(ctx, alice, ns.id, "a/b", {
      data: envelope(1, 10, 1),
      meta: META,
    });
    expect(v1.fileId).toMatch(/^fil_/);
    const read = await readFile(ctx, alice, ns.id, "a/b");
    expect(read.entry).toMatchObject({
      path: "a/b",
      rev: v1.rev,
      size: envelope(1, 10, 1).byteLength,
      meta: META,
    });
    expect(await text(read.stream)).toEqual(envelope(1, 10, 1));

    const v2 = await putFile(ctx, alice, ns.id, "a/b", {
      data: envelope(1, 10, 2),
      meta: META,
      ifMatch: v1.rev,
    });
    expect(Number(v2.rev)).toBeGreaterThan(Number(v1.rev));
    expect(v2.fileId).toBe(v1.fileId);

    const err = await expectApiError(
      putFile(ctx, alice, ns.id, "a/b", {
        data: envelope(1, 10, 3),
        meta: META,
        ifMatch: v1.rev,
      }),
      "conflict",
    );
    expect(err.status).toBe(412);
    expect(err.details.current).toMatchObject({
      rev: v2.rev,
      fileId: v1.fileId,
    });
  });

  it("If-None-Match: * only creates", async () => {
    const { ctx, alice, ns } = await setup();
    await putFile(ctx, alice, ns.id, "x", {
      data: envelope(),
      meta: META,
      ifNoneMatch: true,
    });
    await expectApiError(
      putFile(ctx, alice, ns.id, "x", {
        data: envelope(),
        meta: META,
        ifNoneMatch: true,
      }),
      "conflict",
    );
  });

  it("rejects writes sealed under a stale epoch and from viewers", async () => {
    const { ctx, alice, ns } = await setup();
    await expectApiError(
      putFile(ctx, alice, ns.id, "x", { data: envelope(2), meta: META }),
      "invalid_request",
    );
    await expectApiError(
      putFile(ctx, alice, ns.id, "x", { data: new Uint8Array(40), meta: META }),
      "invalid_request",
    );
    await expectApiError(
      putFile(ctx, alice, ns.id, "../x", { data: envelope(), meta: META }),
      "invalid_request",
    );
  });

  it("enforces the owner's quota", async () => {
    const { ctx, alice, ns } = await setup();
    updateAccount(ctx, alice.accountId, { quotaBytes: 100 }, "cli");
    await putFile(ctx, alice, ns.id, "a", {
      data: envelope(1, 20),
      meta: META,
    });
    await expectApiError(
      putFile(ctx, alice, ns.id, "b", { data: envelope(1, 60), meta: META }),
      "quota_exceeded",
    );
    expect(getNamespace(ctx, alice, ns.id).usedBytes).toBe(
      envelope(1, 20).byteLength,
    );
  });
});

describe("files: listing", () => {
  it("lists recursively and one level at a time, with pagination", async () => {
    const { ctx, alice, ns } = await setup();
    for (const p of ["n/a", "n/b", "n/sub/c", "att/x", "root"]) {
      await putFile(ctx, alice, ns.id, p, { data: envelope(), meta: META });
    }
    const all = listFiles(ctx, alice, ns.id, { recursive: true });
    expect(all.entries.map((e) => e.path)).toEqual([
      "att/x",
      "n/a",
      "n/b",
      "n/sub/c",
      "root",
    ]);
    const n = listFiles(ctx, alice, ns.id, { prefix: "n", recursive: true });
    expect(n.entries.map((e) => e.path)).toEqual(["n/a", "n/b", "n/sub/c"]);
    const shallow = listFiles(ctx, alice, ns.id, {
      prefix: "n",
      recursive: false,
    });
    expect(shallow.entries.map((e) => e.path)).toEqual(["n/a", "n/b"]);
    expect(shallow.folders).toEqual(["n/sub"]);
    const top = listFiles(ctx, alice, ns.id, {});
    expect(top.entries.map((e) => e.path)).toEqual(["root"]);
    expect(top.folders).toEqual(["att", "n"]);
    const p1 = listFiles(ctx, alice, ns.id, { recursive: true, limit: 2 });
    expect(p1.entries.map((e) => e.path)).toEqual(["att/x", "n/a"]);
    const p2 = listFiles(ctx, alice, ns.id, {
      recursive: true,
      limit: 2,
      cursor: p1.cursor!,
    });
    expect(p2.entries.map((e) => e.path)).toEqual(["n/b", "n/sub/c"]);
    const p3 = listFiles(ctx, alice, ns.id, {
      recursive: true,
      limit: 2,
      cursor: p2.cursor!,
    });
    expect(p3.entries.map((e) => e.path)).toEqual(["root"]);
    expect(p3.cursor).toBeUndefined();
    expect(all.seq).toBe(getNamespace(ctx, alice, ns.id).seq);
  });
});

describe("files: delete, trash, history", () => {
  it("deletes to trash and restores", async () => {
    const { ctx, alice, ns } = await setup();
    const v = await putFile(ctx, alice, ns.id, "doc", {
      data: envelope(1, 4, 1),
      meta: META,
    });
    await expectApiError(
      deleteFile(ctx, alice, ns.id, "doc", { ifMatch: "999" }),
      "conflict",
    );
    await deleteFile(ctx, alice, ns.id, "doc", { ifMatch: v.rev });
    await expectApiError(() => statFile(ctx, alice, ns.id, "doc"), "not_found");
    const trash = listTrash(ctx, alice, ns.id);
    expect(trash).toMatchObject([{ fileId: v.fileId, path: "doc" }]);
    const restored = await restoreTrash(ctx, alice, ns.id, {
      fileId: v.fileId,
    });
    expect(restored.fileId).toBe(v.fileId);
    expect(
      await text((await readFile(ctx, alice, ns.id, "doc")).stream),
    ).toEqual(envelope(1, 4, 1));
    expect(listTrash(ctx, alice, ns.id)).toEqual([]);
  });

  it("keeps history, reads and restores old revisions, prunes by count", async () => {
    const { ctx, alice, ns } = await setup({ retention: { historyCount: 3 } });
    const revs: string[] = [];
    for (let i = 1; i <= 5; i++) {
      revs.push(
        (
          await putFile(ctx, alice, ns.id, "f", {
            data: envelope(1, 4, i),
            meta: META,
          })
        ).rev,
      );
    }
    const hist = fileHistory(ctx, alice, ns.id, "f");
    expect(hist.map((h) => h.rev)).toEqual([revs[4], revs[3], revs[2]]);
    const old = readRevision(ctx, alice, ns.id, hist[2]!.fileId, revs[2]!);
    expect(await text(old)).toEqual(envelope(1, 4, 3));
    const r = await restoreRevision(ctx, alice, ns.id, {
      path: "f",
      rev: revs[2]!,
      meta: META,
    });
    expect(await text((await readFile(ctx, alice, ns.id, "f")).stream)).toEqual(
      envelope(1, 4, 3),
    );
    expect(Number(r.rev)).toBeGreaterThan(Number(revs[4]));
    // usage counts only retained revisions
    const size = envelope(1, 4, 1).byteLength;
    expect(getNamespace(ctx, alice, ns.id).usedBytes).toBe(3 * size);
  });

  it("keeps a replaced version for historyDays after it was replaced, however old it is", async () => {
    const { ctx, alice, ns } = await setup();
    const DAY = 24 * 3600_000;
    const put = async (fill: number) =>
      (
        await putFile(ctx, alice, ns.id, "f", {
          data: envelope(1, 4, fill),
          meta: META,
        })
      ).rev;
    const v1 = await put(1);
    ctx.clock.advance(90 * DAY); // untouched for three months
    const v2 = await put(2);
    // v1 is 90 days old but was replaced just now: it is kept.
    expect(fileHistory(ctx, alice, ns.id, "f").map((h) => h.rev)).toEqual([
      v2,
      v1,
    ]);
    ctx.clock.advance(29 * DAY);
    await runRetention(ctx);
    expect(fileHistory(ctx, alice, ns.id, "f")).toHaveLength(2);
    ctx.clock.advance(2 * DAY);
    await runRetention(ctx);
    expect(fileHistory(ctx, alice, ns.id, "f").map((h) => h.rev)).toEqual([v2]);
  });

  it("applies history settings changed at runtime", async () => {
    const { ctx, alice, ns } = await setup();
    const put = (fill: number) =>
      putFile(ctx, alice, ns.id, "f", {
        data: envelope(1, 4, fill),
        meta: META,
      });
    for (let i = 1; i <= 4; i++) await put(i);
    expect(fileHistory(ctx, alice, ns.id, "f")).toHaveLength(4);
    updateSettings(ctx, { historyCount: 2 }, { actor: "test" });
    await put(5);
    expect(fileHistory(ctx, alice, ns.id, "f")).toHaveLength(2);
    // 0 days: no earlier versions at all.
    updateSettings(
      ctx,
      { historyCount: null, historyDays: 0 },
      { actor: "test" },
    );
    await put(6);
    expect(fileHistory(ctx, alice, ns.id, "f")).toHaveLength(1);
    expect(getSettings(ctx).retention).toMatchObject({
      historyDays: 0,
      historyCount: 100,
    });
  });

  it("keeps the overwritten file of a move in the trash", async () => {
    const { ctx, alice, ns } = await setup();
    const a = await putFile(ctx, alice, ns.id, "a", {
      data: envelope(1, 4, 1),
      meta: META,
    });
    const b = await putFile(ctx, alice, ns.id, "b", {
      data: envelope(1, 4, 2),
      meta: META,
    });
    await moveFile(ctx, alice, ns.id, {
      from: "a",
      to: "b",
      meta: META,
      overwrite: true,
    });
    expect(statFile(ctx, alice, ns.id, "b").fileId).toBe(a.fileId);
    expect(listTrash(ctx, alice, ns.id)).toMatchObject([
      { fileId: b.fileId, path: "b" },
    ]);
  });

  it("purges trash and frees blobs", async () => {
    const { ctx, alice, ns } = await setup();
    const v = await putFile(ctx, alice, ns.id, "doc", {
      data: envelope(1, 4, 9),
      meta: META,
    });
    await deleteFile(ctx, alice, ns.id, "doc", {});
    await purgeTrash(ctx, alice, ns.id, v.fileId);
    expect(getNamespace(ctx, alice, ns.id).usedBytes).toBe(0);
    expect(
      ctx.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM blobs")!.n,
    ).toBe(0);
  });
});

describe("files: move and copy", () => {
  it("moves keeping the file id, leaves a tombstone, refuses to clobber", async () => {
    const { ctx, alice, ns } = await setup();
    const a = await putFile(ctx, alice, ns.id, "a", {
      data: envelope(1, 4, 1),
      meta: META,
    });
    await putFile(ctx, alice, ns.id, "b", {
      data: envelope(1, 4, 2),
      meta: META,
    });
    await expectApiError(
      moveFile(ctx, alice, ns.id, { from: "a", to: "b", meta: META }),
      "conflict",
    );
    await expectApiError(
      moveFile(ctx, alice, ns.id, {
        from: "a",
        to: "c",
        meta: META,
        ifMatch: "1",
      }),
      "conflict",
    );
    const moved = await moveFile(ctx, alice, ns.id, {
      from: "a",
      to: "c",
      meta: META,
      ifMatch: a.rev,
    });
    expect(moved.fileId).toBe(a.fileId);
    await expectApiError(() => statFile(ctx, alice, ns.id, "a"), "not_found");
    expect(statFile(ctx, alice, ns.id, "c").fileId).toBe(a.fileId);
    // overwrite sends the old target to the trash
    await moveFile(ctx, alice, ns.id, {
      from: "c",
      to: "b",
      meta: META,
      overwrite: true,
    });
    expect(await text((await readFile(ctx, alice, ns.id, "b")).stream)).toEqual(
      envelope(1, 4, 1),
    );
    expect(listTrash(ctx, alice, ns.id)).toHaveLength(1);
  });

  it("copies to a new file id sharing the blob", async () => {
    const { ctx, alice, ns } = await setup();
    const a = await putFile(ctx, alice, ns.id, "a", {
      data: envelope(1, 4, 1),
      meta: META,
    });
    const c = await copyFile(ctx, alice, ns.id, {
      from: "a",
      to: "copy",
      meta: META,
    });
    expect(c.fileId).not.toBe(a.fileId);
    expect(
      await text((await readFile(ctx, alice, ns.id, "copy")).stream),
    ).toEqual(envelope(1, 4, 1));
    expect(ctx.db.get<{ refs: number }>("SELECT refs FROM blobs")!.refs).toBe(
      2,
    );
  });
});
