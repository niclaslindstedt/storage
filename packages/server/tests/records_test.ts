import { describe, expect, it } from "vitest";

import { ApiError } from "../src/errors.ts";
import { changes } from "../src/services/changes.ts";
import { putFile } from "../src/services/files.ts";
import {
  createNamespace,
  getNamespace,
  updateNamespaceMeta,
} from "../src/services/namespaces.ts";
import {
  batch,
  deleteRecord,
  getRecord,
  listRecords,
  putRecord,
} from "../src/services/records.ts";
import { runRetention } from "../src/services/retention.ts";
import { toB64u } from "../src/util/b64.ts";
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

function setup(overrides = {}) {
  const ctx = testContext(overrides);
  const alice = principal(ctx, "alice");
  const ns = createNamespace(ctx, alice, {
    app: "meds",
    meta: envelopeB64u(),
    wrap: WRAP,
  });
  return { ctx, alice, ns };
}

const V = (fill: number) => envelopeB64u(1, 8, fill);

describe("records", () => {
  it("puts, gets, lists and deletes rows with per-row revisions", () => {
    const { ctx, alice, ns } = setup();
    const a = putRecord(ctx, alice, ns.id, "days", "k1", { value: V(1) });
    const b = putRecord(ctx, alice, ns.id, "days", "k2", { value: V(2) });
    expect(Number(b.rev)).toBeGreaterThan(Number(a.rev));
    expect(getRecord(ctx, alice, ns.id, "days", "k1")).toMatchObject({
      key: "k1",
      rev: a.rev,
      value: V(1),
    });
    const list = listRecords(ctx, alice, ns.id, "days", {});
    expect(list.records.map((r) => r.key)).toEqual(["k1", "k2"]);
    const d = deleteRecord(ctx, alice, ns.id, "days", "k1", { ifRev: a.rev });
    expect(() => getRecord(ctx, alice, ns.id, "days", "k1")).toThrow(ApiError);
    const withDeleted = listRecords(ctx, alice, ns.id, "days", {
      includeDeleted: true,
    });
    expect(withDeleted.records.find((r) => r.key === "k1")).toMatchObject({
      value: null,
      rev: d.rev,
    });
  });

  it("detects stale row writes — only that row conflicts", async () => {
    const { ctx, alice, ns } = setup();
    const a = putRecord(ctx, alice, ns.id, "c", "row", { value: V(1) });
    putRecord(ctx, alice, ns.id, "c", "row", { value: V(2), ifRev: a.rev });
    const err = await expectApiError(
      () =>
        putRecord(ctx, alice, ns.id, "c", "row", { value: V(3), ifRev: a.rev }),
      "conflict",
    );
    expect(err.details.current).toMatchObject({ key: "row", value: V(2) });
    await expectApiError(
      () =>
        putRecord(ctx, alice, ns.id, "c", "row", {
          value: V(3),
          ifAbsent: true,
        }),
      "conflict",
    );
    // other rows are unaffected
    putRecord(ctx, alice, ns.id, "c", "other", { value: V(4), ifAbsent: true });
  });

  it("recreating over a tombstone works with ifAbsent or the tombstone rev", () => {
    const { ctx, alice, ns } = setup();
    const a = putRecord(ctx, alice, ns.id, "c", "k", { value: V(1) });
    const d = deleteRecord(ctx, alice, ns.id, "c", "k", {});
    putRecord(ctx, alice, ns.id, "c", "k", { value: V(2), ifRev: d.rev });
    expect(a.rev).not.toBe(d.rev);
  });

  it("validates epoch, size and names", async () => {
    const { ctx, alice, ns } = setup({ limits: { maxRecordBytes: 100 } });
    await expectApiError(
      () => putRecord(ctx, alice, ns.id, "c", "k", { value: envelopeB64u(2) }),
      "invalid_request",
    );
    await expectApiError(
      () =>
        putRecord(ctx, alice, ns.id, "c", "k", { value: envelopeB64u(1, 200) }),
      "too_large",
    );
    await expectApiError(
      () => putRecord(ctx, alice, ns.id, "c/x", "k", { value: V(1) }),
      "invalid_request",
    );
  });
});

describe("batch", () => {
  it("atomic batches apply all or nothing at one seq", async () => {
    const { ctx, alice, ns } = setup();
    const a = putRecord(ctx, alice, ns.id, "c", "a", { value: V(1) });
    const err = await expectApiError(
      batch(ctx, alice, ns.id, {
        atomic: true,
        ops: [
          { op: "put", collection: "c", key: "b", value: V(2) },
          { op: "put", collection: "c", key: "a", value: V(3), ifRev: "999" },
        ],
      }),
      "conflict",
    );
    expect(err.details.failures).toMatchObject([
      { index: 1, current: { key: "a", rev: a.rev } },
    ]);
    expect(() => getRecord(ctx, alice, ns.id, "c", "b")).toThrow();

    const ok = await batch(ctx, alice, ns.id, {
      atomic: true,
      ops: [
        { op: "put", collection: "c", key: "b", value: V(2) },
        { op: "put", collection: "c", key: "a", value: V(3), ifRev: a.rev },
        { op: "check", collection: "c", key: "a", rev: a.rev },
      ],
    });
    expect(ok.results.slice(0, 2).map((r) => r.ok && r.rev)).toEqual([
      ok.seq,
      ok.seq,
    ]);
    expect(ok.results[2]).toEqual({ ok: true, rev: a.rev });
  });

  it("non-atomic batches report per-op results", async () => {
    const { ctx, alice, ns } = setup();
    const a = putRecord(ctx, alice, ns.id, "c", "a", { value: V(1) });
    putRecord(ctx, alice, ns.id, "c", "a", { value: V(2), ifRev: a.rev });
    const res = await batch(ctx, alice, ns.id, {
      atomic: false,
      ops: [
        { op: "put", collection: "c", key: "a", value: V(3), ifRev: a.rev },
        { op: "put", collection: "c", key: "new", value: V(4), ifAbsent: true },
        { op: "delete", collection: "c", key: "missing" },
      ],
    });
    expect(res.results[0]).toMatchObject({
      ok: false,
      error: "conflict",
      current: { value: V(2) },
    });
    expect(res.results[1]).toMatchObject({ ok: true });
    expect(res.results[2]).toMatchObject({ ok: false, error: "not_found" });
  });

  it("carries small files", async () => {
    const { ctx, alice, ns } = setup();
    const res = await batch(ctx, alice, ns.id, {
      atomic: true,
      ops: [
        {
          op: "file.put",
          path: "doc",
          content: toB64u(envelope()),
          meta: V(1),
        },
        { op: "put", collection: "idx", key: "doc", value: V(2) },
      ],
    });
    expect(res.results.every((r) => r.ok)).toBe(true);
    const del = await batch(ctx, alice, ns.id, {
      atomic: true,
      ops: [
        {
          op: "file.delete",
          path: "doc",
          ifRev: res.results[0]!.ok ? res.results[0]!.rev : "",
        },
      ],
    });
    expect(del.results[0]!.ok).toBe(true);
  });
});

describe("change feed", () => {
  it("reports files, rows, deletions and namespace changes since a seq", async () => {
    const { ctx, alice, ns } = setup();
    const start = Number(getNamespace(ctx, alice, ns.id).seq);
    await putFile(ctx, alice, ns.id, "f", { data: envelope(), meta: V(1) });
    putRecord(ctx, alice, ns.id, "c", "k", { value: V(2) });
    deleteRecord(ctx, alice, ns.id, "c", "k", {});
    updateNamespaceMeta(ctx, alice, ns.id, V(3));
    const feed = await changes(ctx, alice, ns.id, { since: String(start) });
    expect(feed.changes.map((c) => c.kind)).toEqual([
      "file",
      "record",
      "namespace",
    ]);
    expect(feed.changes[1]).toMatchObject({
      kind: "record",
      collection: "c",
      key: "k",
      deleted: true,
      value: null,
    });
    expect(feed.seq).toBe(getNamespace(ctx, alice, ns.id).seq);
    expect(feed.more).toBe(false);
    const none = await changes(ctx, alice, ns.id, { since: feed.seq });
    expect(none.changes).toEqual([]);
  });

  it("pages without splitting a batch", async () => {
    const { ctx, alice, ns } = setup();
    const start = getNamespace(ctx, alice, ns.id).seq;
    await batch(ctx, alice, ns.id, {
      atomic: true,
      ops: [1, 2, 3].map((i) => ({
        op: "put" as const,
        collection: "c",
        key: `k${i}`,
        value: V(i),
      })),
    });
    putRecord(ctx, alice, ns.id, "c", "k4", { value: V(4) });
    const p1 = await changes(ctx, alice, ns.id, { since: start, limit: 2 });
    expect(p1.changes).toHaveLength(3);
    expect(p1.more).toBe(true);
    const p2 = await changes(ctx, alice, ns.id, { since: p1.seq, limit: 2 });
    expect(p2.changes.map((c) => c.kind === "record" && c.key)).toEqual(["k4"]);
  });

  it("long-polls until a change arrives", async () => {
    const { ctx, alice, ns } = setup();
    const since = getNamespace(ctx, alice, ns.id).seq;
    const pending = changes(ctx, alice, ns.id, { since, waitMs: 5_000 });
    setTimeout(
      () => putRecord(ctx, alice, ns.id, "c", "k", { value: V(1) }),
      20,
    );
    const feed = await pending;
    expect(feed.changes).toHaveLength(1);
  });

  it("answers 410 for cursors older than purged tombstones", async () => {
    const { ctx, alice, ns } = setup({ retention: { tombstoneDays: 1 } });
    const since = getNamespace(ctx, alice, ns.id).seq;
    putRecord(ctx, alice, ns.id, "c", "k", { value: V(1) });
    deleteRecord(ctx, alice, ns.id, "c", "k", {});
    ctx.clock.advance(2 * 24 * 3600_000);
    await runRetention(ctx);
    await expectApiError(
      changes(ctx, alice, ns.id, { since }),
      "cursor_expired",
    );
    const fresh = await changes(ctx, alice, ns.id, {
      since: getNamespace(ctx, alice, ns.id).seq,
    });
    expect(fresh.changes).toEqual([]);
  });
});
