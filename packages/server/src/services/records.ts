// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Records (SPEC §6.5): rows in named collections — the key-value store and
// the unit of row-level conflict resolution. Every row has its own revision,
// so two devices editing different rows never conflict, and a stale write
// fails for that row only. Deletes leave tombstones so a deletion syncs
// instead of resurrecting. Collection names, keys and values are ciphertext.

import type { PinnedBlob } from "../blob-refs.ts";
import type { Ctx } from "../context.ts";
import { requireEpoch } from "../envelope.ts";
import {
  ApiError,
  badRequest,
  conflict,
  notFound,
  preconditionFailed,
  tooLarge,
} from "../errors.ts";
import { checkB64u, checkPath, checkSegment } from "../validate.ts";
import { toB64u } from "../util/b64.ts";
import { newId } from "../util/random.ts";
import { assertQuota } from "./accounts.ts";
import { checkMetaHeader, pruneHistory, toEntry } from "./files.ts";
import {
  bumpSeq,
  type NamespaceRow,
  publish,
  requireRole,
} from "./namespaces.ts";
import type { Principal } from "./principal.ts";

export type RecordEntry = {
  collection: string;
  key: string;
  rev: string;
  value: string | null;
  deleted: boolean;
  updatedAt: number;
};

type RecordRow = {
  namespace_id: string;
  collection: string;
  key: string;
  rev: number;
  value: Uint8Array | null;
  size: number;
  updated_at: number;
};

export function toRecordEntry(r: RecordRow): RecordEntry {
  return {
    collection: r.collection,
    key: r.key,
    rev: String(r.rev),
    value: r.value === null ? null : toB64u(new Uint8Array(r.value)),
    deleted: r.value === null,
    updatedAt: r.updated_at,
  };
}

function rowOf(
  ctx: Ctx,
  nsId: string,
  collection: string,
  key: string,
): RecordRow | null {
  return (
    ctx.db.get<RecordRow>(
      "SELECT * FROM records WHERE namespace_id = ? AND collection = ? AND key = ?",
      nsId,
      collection,
      key,
    ) ?? null
  );
}

function checkValue(ctx: Ctx, value: unknown, epoch: number): Uint8Array {
  if (typeof value !== "string") throw badRequest("value is required");
  const bytes = checkB64u(value, "value");
  if (bytes.byteLength > ctx.config.limits.maxRecordBytes)
    throw tooLarge("value is too large");
  requireEpoch(bytes, epoch, "value");
  return bytes;
}

function checkRevString(rev: unknown, what: string): number | undefined {
  if (rev === undefined || rev === null) return undefined;
  if (typeof rev !== "string" || !/^\d{1,15}$/.test(rev))
    throw badRequest(`${what} must be a revision`);
  return Number(rev);
}

type Cond = { ifRev?: string; ifAbsent?: boolean };

/** Why a conditional row write would fail, or null when it may proceed. */
function rowCondition(current: RecordRow | null, cond: Cond): ApiError | null {
  const live = current && current.value !== null ? current : null;
  if (cond.ifAbsent && live) return preconditionFailed(toRecordEntry(live));
  const ifRev = checkRevString(cond.ifRev, "ifRev");
  if (ifRev !== undefined && (current?.rev ?? -1) !== ifRev) {
    return preconditionFailed(current ? toRecordEntry(current) : null);
  }
  return null;
}

function writeRow(
  ctx: Ctx,
  ns: NamespaceRow,
  collection: string,
  key: string,
  value: Uint8Array | null,
  seq: number,
): void {
  const previous = rowOf(ctx, ns.id, collection, key);
  const size = value?.byteLength ?? 0;
  ctx.db.run(
    `INSERT INTO records(namespace_id, collection, key, rev, value, size, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(namespace_id, collection, key) DO UPDATE SET
       rev = excluded.rev, value = excluded.value, size = excluded.size, updated_at = excluded.updated_at`,
    ns.id,
    collection,
    key,
    seq,
    value,
    size,
    ctx.clock.now(),
  );
  const delta = size - (previous?.size ?? 0);
  if (delta !== 0) {
    ctx.db.run(
      "UPDATE namespaces SET used_bytes = used_bytes + ? WHERE id = ?",
      delta,
      ns.id,
    );
  }
}

export function putRecord(
  ctx: Ctx,
  principal: Principal,
  nsId: string,
  collection: string,
  key: string,
  input: { value: unknown } & Cond,
): { rev: string; seq: string } {
  checkSegment(collection, "collection");
  checkSegment(key, "key");
  const out = ctx.db.tx(() => {
    const { ns } = requireRole(ctx, principal, nsId, "editor");
    const value = checkValue(ctx, input.value, ns.epoch);
    const current = rowOf(ctx, nsId, collection, key);
    const fail = rowCondition(current, input);
    if (fail) throw fail;
    assertQuota(
      ctx,
      ns.owner_account_id,
      value.byteLength - (current?.size ?? 0),
    );
    const seq = bumpSeq(ctx, nsId);
    writeRow(ctx, ns, collection, key, value, seq);
    return { rev: String(seq), seq: String(seq) };
  });
  publish(ctx, nsId);
  return out;
}

export function getRecord(
  ctx: Ctx,
  principal: Principal,
  nsId: string,
  collection: string,
  key: string,
): RecordEntry {
  requireRole(ctx, principal, nsId, "viewer");
  const r = rowOf(
    ctx,
    nsId,
    checkSegment(collection, "collection"),
    checkSegment(key, "key"),
  );
  if (!r || r.value === null) {
    throw notFound(
      "no such record",
      r ? { rev: String(r.rev), deleted: true } : undefined,
    );
  }
  return toRecordEntry(r);
}

export function listRecords(
  ctx: Ctx,
  principal: Principal,
  nsId: string,
  collection: string,
  opts: { cursor?: string; limit?: number; includeDeleted?: boolean },
): { records: RecordEntry[]; cursor?: string; seq: string } {
  const { ns } = requireRole(ctx, principal, nsId, "viewer");
  checkSegment(collection, "collection");
  const limit = Math.min(Math.max(opts.limit ?? 1000, 1), 5000);
  const after =
    opts.cursor === undefined ? null : checkSegment(opts.cursor, "cursor");
  const rows = ctx.db.all<RecordRow>(
    `SELECT * FROM records WHERE namespace_id = ? AND collection = ?
       ${opts.includeDeleted ? "" : "AND value IS NOT NULL"}
       ${after !== null ? "AND key > ?" : ""}
     ORDER BY key LIMIT ?`,
    ...(after !== null
      ? [nsId, collection, after, limit + 1]
      : [nsId, collection, limit + 1]),
  );
  const page = rows.slice(0, limit);
  return {
    records: page.map(toRecordEntry),
    ...(rows.length > limit ? { cursor: page[page.length - 1]!.key } : {}),
    seq: String(ns.seq),
  };
}

export function deleteRecord(
  ctx: Ctx,
  principal: Principal,
  nsId: string,
  collection: string,
  key: string,
  cond: { ifRev?: string },
): { rev: string; seq: string } {
  checkSegment(collection, "collection");
  checkSegment(key, "key");
  const out = ctx.db.tx(() => {
    const { ns } = requireRole(ctx, principal, nsId, "editor");
    const current = rowOf(ctx, nsId, collection, key);
    if (!current || current.value === null) throw notFound("no such record");
    const fail = rowCondition(current, cond);
    if (fail) throw fail;
    const seq = bumpSeq(ctx, nsId);
    writeRow(ctx, ns, collection, key, null, seq);
    return { rev: String(seq), seq: String(seq) };
  });
  publish(ctx, nsId);
  return out;
}

// ---- batch -------------------------------------------------------------------

export type BatchOp =
  | {
      op: "put";
      collection: string;
      key: string;
      value: string;
      ifRev?: string;
      ifAbsent?: boolean;
    }
  | { op: "delete"; collection: string; key: string; ifRev?: string }
  | { op: "check"; collection: string; key: string; rev: string }
  | {
      op: "file.put";
      path: string;
      content: string;
      meta: string;
      ifRev?: string;
      ifAbsent?: boolean;
    }
  | { op: "file.delete"; path: string; ifRev?: string };

export type BatchResult =
  | { ok: true; rev: string }
  | { ok: false; error: string; message: string; current?: unknown };

const MAX_INLINE_FILE = 1024 * 1024;

type FileRow = {
  path: string;
  file_id: string;
  rev: number;
  size: number;
  blob_hash: string | null;
  meta: string | null;
  updated_at: number;
  created_at: number;
  namespace_id: string;
};

function fileRow(ctx: Ctx, nsId: string, path: string): FileRow | null {
  return (
    ctx.db.get<FileRow>(
      "SELECT * FROM files WHERE namespace_id = ? AND path = ?",
      nsId,
      path,
    ) ?? null
  );
}

function normalizeOp(raw: unknown): BatchOp {
  if (typeof raw !== "object" || raw === null)
    throw badRequest("each op must be an object");
  const o = raw as Record<string, unknown>;
  switch (o.op) {
    case "put":
    case "delete":
    case "check":
      checkSegment(String(o.collection ?? ""), "collection");
      checkSegment(String(o.key ?? ""), "key");
      if (o.op === "check") checkRevString(o.rev ?? "", "rev");
      return o as BatchOp;
    case "file.put":
    case "file.delete":
      checkPath(String(o.path ?? ""));
      return o as BatchOp;
    default:
      throw badRequest(`unknown op ${String(o.op)}`);
  }
}

export async function batch(
  ctx: Ctx,
  principal: Principal,
  nsId: string,
  input: { atomic?: boolean; ops: unknown },
): Promise<{ seq: string; results: BatchResult[] }> {
  if (!Array.isArray(input.ops) || input.ops.length === 0)
    throw badRequest("ops must be a non-empty array");
  if (input.ops.length > ctx.config.limits.maxBatchOps)
    throw badRequest("too many ops");
  const ops = input.ops.map(normalizeOp);
  const atomic = input.atomic !== false;
  const { ns: before } = requireRole(ctx, principal, nsId, "editor");

  // Write inline file contents first (async), pinned until the transaction ends.
  const blobs = new Map<number, PinnedBlob>();
  try {
    for (const [i, op] of ops.entries()) {
      if (op.op !== "file.put") continue;
      if (typeof op.content !== "string")
        throw badRequest("content is required");
      const bytes = checkB64u(op.content, "content");
      if (bytes.byteLength > MAX_INLINE_FILE)
        throw tooLarge("inline file content is limited to 1 MiB");
      requireEpoch(bytes, before.epoch, "content");
      blobs.set(i, await ctx.blobs.write(bytes));
    }

    const out = ctx.db.tx(() => {
      const { ns } = requireRole(ctx, principal, nsId, "editor");
      const results: BatchResult[] = [];
      let seq: number | null = null;
      const nextSeq = () => (seq ??= bumpSeq(ctx, nsId));

      // Pass 1: validate every op and evaluate its condition.
      const failures: { index: number; error: ApiError }[] = [];
      const values = new Map<number, Uint8Array>();
      const metas = new Map<number, string>();
      let growth = 0;
      for (const [i, op] of ops.entries()) {
        try {
          const err = evaluate(ctx, ns, op);
          if (err) throw err;
          if (op.op === "put") {
            const v = checkValue(ctx, op.value, ns.epoch);
            values.set(i, v);
            growth +=
              v.byteLength -
              (rowOf(ctx, nsId, op.collection, op.key)?.size ?? 0);
          }
          if (op.op === "file.put") {
            metas.set(i, checkMetaHeader(ctx, op.meta, ns.epoch));
            growth += blobs.get(i)!.size;
          }
        } catch (err) {
          if (!(err instanceof ApiError)) throw err;
          failures.push({ index: i, error: err });
        }
      }
      if (atomic && failures.length > 0) {
        throw conflict("batch failed", {
          failures: failures.map((f) => ({
            index: f.index,
            error: f.error.code,
            message: f.error.message,
            ...(f.error.details.current !== undefined
              ? { current: f.error.details.current }
              : {}),
          })),
        });
      }
      assertQuota(ctx, ns.owner_account_id, growth);

      // Pass 2: apply.
      const failed = new Map(failures.map((f) => [f.index, f.error]));
      for (const [i, op] of ops.entries()) {
        const err = failed.get(i);
        if (err) {
          results.push({
            ok: false,
            error: err.code,
            message: err.message,
            ...(err.details.current !== undefined
              ? { current: err.details.current }
              : {}),
          });
          continue;
        }
        if (op.op === "check") {
          results.push({ ok: true, rev: op.rev });
          continue;
        }
        const s = nextSeq();
        apply(ctx, ns, op, s, values.get(i), blobs.get(i), metas.get(i));
        results.push({ ok: true, rev: String(s) });
      }
      return { seq: String(seq ?? ns.seq), results, changed: seq !== null };
    });
    if (out.changed) publish(ctx, nsId);
    return { seq: out.seq, results: out.results };
  } finally {
    for (const b of blobs.values()) await b.release();
    await ctx.blobs.flush();
  }
}

function evaluate(ctx: Ctx, ns: NamespaceRow, op: BatchOp): ApiError | null {
  switch (op.op) {
    case "put":
      return rowCondition(rowOf(ctx, ns.id, op.collection, op.key), op);
    case "delete": {
      const r = rowOf(ctx, ns.id, op.collection, op.key);
      if (!r || r.value === null) return notFound("no such record");
      return rowCondition(r, op);
    }
    case "check": {
      const r = rowOf(ctx, ns.id, op.collection, op.key);
      return r && String(r.rev) === op.rev
        ? null
        : preconditionFailed(r ? toRecordEntry(r) : null);
    }
    case "file.put":
    case "file.delete": {
      const r = fileRow(ctx, ns.id, op.path);
      const live = r && r.blob_hash !== null ? r : null;
      if (op.op === "file.delete" && !live) return notFound("no such file");
      if (op.op === "file.put" && op.ifAbsent && live)
        return preconditionFailed(toEntry(live as never));
      const ifRev = checkRevString(op.ifRev, "ifRev");
      if (ifRev !== undefined && (!live || live.rev !== ifRev)) {
        return preconditionFailed(live ? toEntry(live as never) : null);
      }
      return null;
    }
  }
}

function apply(
  ctx: Ctx,
  ns: NamespaceRow,
  op: BatchOp,
  seq: number,
  value: Uint8Array | undefined,
  blob: PinnedBlob | undefined,
  meta: string | undefined,
): void {
  const now = ctx.clock.now();
  switch (op.op) {
    case "put":
      writeRow(ctx, ns, op.collection, op.key, value!, seq);
      return;
    case "delete":
      writeRow(ctx, ns, op.collection, op.key, null, seq);
      return;
    case "check":
      return;
    case "file.put": {
      const r = fileRow(ctx, ns.id, op.path);
      const fileId = r && r.blob_hash !== null ? r.file_id : newId("fil");
      ctx.db.run(
        `INSERT INTO files(namespace_id, path, file_id, rev, size, blob_hash, meta, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(namespace_id, path) DO UPDATE SET file_id = excluded.file_id, rev = excluded.rev,
           size = excluded.size, blob_hash = excluded.blob_hash, meta = excluded.meta, updated_at = excluded.updated_at`,
        ns.id,
        op.path,
        fileId,
        seq,
        blob!.size,
        blob!.hash,
        meta!,
        now,
        now,
      );
      ctx.db.run(
        `INSERT INTO file_revisions(namespace_id, file_id, rev, path, size, blob_hash, meta, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ns.id,
        fileId,
        seq,
        op.path,
        blob!.size,
        blob!.hash,
        meta!,
        now,
      );
      ctx.blobs.ref(blob!.hash, blob!.size);
      ctx.db.run(
        "UPDATE namespaces SET used_bytes = used_bytes + ? WHERE id = ?",
        blob!.size,
        ns.id,
      );
      pruneHistory(ctx, ns.id, fileId);
      return;
    }
    case "file.delete": {
      const r = fileRow(ctx, ns.id, op.path)!;
      ctx.db.run(
        `INSERT INTO trash(namespace_id, file_id, path, rev, size, meta, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(namespace_id, file_id) DO UPDATE SET path = excluded.path, rev = excluded.rev,
           size = excluded.size, meta = excluded.meta, deleted_at = excluded.deleted_at`,
        ns.id,
        r.file_id,
        r.path,
        r.rev,
        r.size,
        r.meta,
        now,
      );
      ctx.db.run(
        "UPDATE files SET rev = ?, blob_hash = NULL, meta = NULL, size = 0, updated_at = ? WHERE namespace_id = ? AND path = ?",
        seq,
        now,
        ns.id,
        op.path,
      );
      return;
    }
  }
}
