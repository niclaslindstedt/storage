// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Files (SPEC §6.4): opaque ciphertext at opaque (encrypted) paths, with
// server-side compare-and-swap so two devices can never silently overwrite
// each other, plus move / copy, per-file history, and a trash. A file keeps
// its server-assigned `fileId` across overwrites and moves; its history is
// keyed by that id.

import type { Readable } from "node:stream";

import type { PinnedBlob } from "../blob-refs.ts";
import type { Ctx } from "../context.ts";
import { requireEpoch } from "../envelope.ts";
import {
  badRequest,
  conflict,
  notFound,
  preconditionFailed,
  tooLarge,
} from "../errors.ts";
import { checkB64u, checkPath } from "../validate.ts";
import { newId } from "../util/random.ts";
import { assertQuota } from "./accounts.ts";
import {
  bumpSeq,
  type NamespaceRow,
  publish,
  requireRole,
} from "./namespaces.ts";
import type { Principal } from "./principal.ts";
import { retention } from "./settings.ts";

export type FileEntry = {
  path: string;
  fileId: string;
  rev: string;
  size: number;
  meta: string | null;
  updatedAt: number;
};

type FileRow = {
  namespace_id: string;
  path: string;
  file_id: string;
  rev: number;
  size: number;
  blob_hash: string | null;
  meta: string | null;
  created_at: number;
  updated_at: number;
};

type RevisionRow = {
  file_id: string;
  rev: number;
  path: string;
  size: number;
  blob_hash: string;
  meta: string | null;
  created_at: number;
};

const DAY = 24 * 3600_000;

export function toEntry(r: FileRow): FileEntry {
  return {
    path: r.path,
    fileId: r.file_id,
    rev: String(r.rev),
    size: r.size,
    meta: r.meta,
    updatedAt: r.updated_at,
  };
}

function row(ctx: Ctx, nsId: string, path: string): FileRow | null {
  return (
    ctx.db.get<FileRow>(
      "SELECT * FROM files WHERE namespace_id = ? AND path = ?",
      nsId,
      path,
    ) ?? null
  );
}

function liveRow(ctx: Ctx, nsId: string, path: string): FileRow | null {
  const r = row(ctx, nsId, path);
  return r && r.blob_hash !== null ? r : null;
}

export function checkMetaHeader(
  ctx: Ctx,
  meta: unknown,
  epoch: number,
): string {
  if (typeof meta !== "string" || meta.length === 0)
    throw badRequest("meta is required");
  const bytes = checkB64u(meta, "meta");
  if (bytes.byteLength > ctx.config.limits.maxMetaBytes)
    throw badRequest("meta is too large");
  requireEpoch(bytes, epoch, "meta");
  return meta;
}

function checkRev(rev: string | undefined, what: string): number | undefined {
  if (rev === undefined) return undefined;
  if (!/^\d{1,15}$/.test(rev)) throw badRequest(`${what} must be a revision`);
  return Number(rev);
}

// ---- listing & reading ---------------------------------------------------

export function listFiles(
  ctx: Ctx,
  principal: Principal,
  nsId: string,
  opts: {
    prefix?: string;
    recursive?: boolean;
    cursor?: string;
    limit?: number;
  },
): { entries: FileEntry[]; folders?: string[]; cursor?: string; seq: string } {
  const { ns } = requireRole(ctx, principal, nsId, "viewer");
  const prefix = checkPath(opts.prefix ?? "", "prefix", true);
  const limit = Math.min(Math.max(opts.limit ?? 1000, 1), 5000);
  const cursor =
    opts.cursor === undefined ? undefined : checkPath(opts.cursor, "cursor");
  // Range scan on the primary key: every path under `p/` sorts between
  // `p/` and `p0` ('0' follows '/' in ASCII).
  const lo = prefix === "" ? "" : `${prefix}/`;
  const hi = prefix === "" ? "￿" : `${prefix}0`;
  const after = cursor !== undefined && cursor >= lo ? cursor : null;
  const rows = ctx.db.all<FileRow>(
    `SELECT * FROM files WHERE namespace_id = ? AND path >= ? AND path < ?
       AND blob_hash IS NOT NULL ${after !== null ? "AND path > ?" : ""}
     ORDER BY path LIMIT ?`,
    ...(after !== null
      ? [nsId, lo, hi, after, limit + 1]
      : [nsId, lo, hi, limit + 1]),
  );
  const seq = String(ns.seq);
  if (opts.recursive) {
    const page = rows.slice(0, limit);
    return {
      entries: page.map(toEntry),
      ...(rows.length > limit ? { cursor: page[page.length - 1]!.path } : {}),
      seq,
    };
  }
  // One level: direct children as entries, deeper paths as folder names.
  const all = ctx.db.all<{ path: string }>(
    `SELECT path FROM files WHERE namespace_id = ? AND path >= ? AND path < ? AND blob_hash IS NOT NULL`,
    nsId,
    lo,
    hi,
  );
  const folders = new Set<string>();
  for (const { path } of all) {
    const rest = path.slice(lo.length);
    const slash = rest.indexOf("/");
    if (slash >= 0) folders.add(lo + rest.slice(0, slash));
  }
  const direct = rows.filter((r) => !r.path.slice(lo.length).includes("/"));
  const page = direct.slice(0, limit);
  return {
    entries: page.map(toEntry),
    folders: [...folders].sort(),
    ...(rows.length > limit
      ? { cursor: rows[Math.min(limit, rows.length) - 1]!.path }
      : {}),
    seq,
  };
}

export function statFile(
  ctx: Ctx,
  principal: Principal,
  nsId: string,
  path: string,
): FileEntry {
  requireRole(ctx, principal, nsId, "viewer");
  const r = liveRow(ctx, nsId, checkPath(path));
  if (!r) throw notFound("no such file");
  return toEntry(r);
}

export async function readFile(
  ctx: Ctx,
  principal: Principal,
  nsId: string,
  path: string,
): Promise<{ entry: FileEntry; stream: Readable }> {
  requireRole(ctx, principal, nsId, "viewer");
  const r = liveRow(ctx, nsId, checkPath(path));
  if (!r) throw notFound("no such file");
  const stream = ctx.blobs.store.stream(r.blob_hash!);
  if (!stream)
    throw new Error(`blob ${r.blob_hash} missing for ${nsId}/${path}`);
  return { entry: toEntry(r), stream };
}

// ---- writing ---------------------------------------------------------------

/** Record a new version (inside a transaction). Returns the new row. */
function writeVersion(
  ctx: Ctx,
  ns: NamespaceRow,
  path: string,
  blob: { hash: string; size: number },
  meta: string,
  fileId: string,
  seq: number,
): FileRow {
  const now = ctx.clock.now();
  const existing = row(ctx, ns.id, path);
  ctx.db.run(
    `INSERT INTO files(namespace_id, path, file_id, rev, size, blob_hash, meta, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(namespace_id, path) DO UPDATE SET
       file_id = excluded.file_id, rev = excluded.rev, size = excluded.size,
       blob_hash = excluded.blob_hash, meta = excluded.meta, updated_at = excluded.updated_at,
       created_at = CASE WHEN files.blob_hash IS NULL THEN excluded.created_at ELSE files.created_at END`,
    ns.id,
    path,
    fileId,
    seq,
    blob.size,
    blob.hash,
    meta,
    existing?.created_at ?? now,
    now,
  );
  addRevision(ctx, ns.id, {
    fileId,
    rev: seq,
    path,
    size: blob.size,
    hash: blob.hash,
    meta,
  });
  pruneHistory(ctx, ns.id, fileId);
  return row(ctx, ns.id, path)!;
}

function addRevision(
  ctx: Ctx,
  nsId: string,
  v: {
    fileId: string;
    rev: number;
    path: string;
    size: number;
    hash: string;
    meta: string | null;
  },
): void {
  ctx.db.run(
    `INSERT INTO file_revisions(namespace_id, file_id, rev, path, size, blob_hash, meta, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    nsId,
    v.fileId,
    v.rev,
    v.path,
    v.size,
    v.hash,
    v.meta,
    ctx.clock.now(),
  );
  ctx.blobs.ref(v.hash, v.size);
  ctx.db.run(
    "UPDATE namespaces SET used_bytes = used_bytes + ? WHERE id = ?",
    v.size,
    nsId,
  );
}

function dropRevision(ctx: Ctx, nsId: string, r: RevisionRow): void {
  ctx.db.run(
    "DELETE FROM file_revisions WHERE namespace_id = ? AND file_id = ? AND rev = ?",
    nsId,
    r.file_id,
    r.rev,
  );
  ctx.blobs.unref(r.blob_hash);
  ctx.db.run(
    "UPDATE namespaces SET used_bytes = used_bytes - ? WHERE id = ?",
    r.size,
    nsId,
  );
}

/**
 * Keep every version for `historyDays` after it was replaced — a version's
 * age counts from when a newer one took its place, so overwriting a file
 * that has not changed in months still keeps the old content for the whole
 * window — and never more than `historyCount` versions. The version a live
 * path or a trashed file still points at is always kept.
 */
export function pruneHistory(ctx: Ctx, nsId: string, fileId: string): void {
  const { historyCount, historyDays } = retention(ctx);
  const cutoff = ctx.clock.now() - historyDays * DAY;
  const revs = ctx.db.all<RevisionRow>(
    "SELECT * FROM file_revisions WHERE namespace_id = ? AND file_id = ? ORDER BY rev DESC",
    nsId,
    fileId,
  );
  const pinned = new Set(
    ctx.db
      .all<{ rev: number }>(
        `SELECT rev FROM files WHERE namespace_id = ? AND file_id = ? AND blob_hash IS NOT NULL
         UNION SELECT rev FROM trash WHERE namespace_id = ? AND file_id = ?`,
        nsId,
        fileId,
        nsId,
        fileId,
      )
      .map((r) => r.rev),
  );
  revs.forEach((r, i) => {
    if (pinned.has(r.rev)) return;
    // The newest version has not been replaced yet (a trashed file's is pinned).
    const replacedAt = i === 0 ? null : revs[i - 1]!.created_at;
    const expired =
      replacedAt !== null && (historyDays === 0 || replacedAt < cutoff);
    if (i >= historyCount || expired) dropRevision(ctx, nsId, r);
  });
}

type Conditions = { ifMatch?: string; ifNoneMatch?: boolean };

function checkConditions(current: FileRow | null, cond: Conditions): void {
  const live = current && current.blob_hash !== null ? current : null;
  if (cond.ifNoneMatch && live) throw preconditionFailed(toEntry(live));
  const ifMatch = checkRev(cond.ifMatch, "If-Match");
  if (ifMatch !== undefined && (!live || live.rev !== ifMatch)) {
    throw preconditionFailed(live ? toEntry(live) : null);
  }
}

/** Store an already-written (pinned) blob as the new version of `path`. */
export async function commitBlob(
  ctx: Ctx,
  principal: Principal,
  nsId: string,
  path: string,
  blob: PinnedBlob,
  input: { meta: unknown } & Conditions,
): Promise<{ rev: string; fileId: string; size: number; seq: string }> {
  try {
    const out = ctx.db.tx(() => {
      const { ns } = requireRole(ctx, principal, nsId, "editor");
      const meta = checkMetaHeader(ctx, input.meta, ns.epoch);
      const current = row(ctx, nsId, path);
      checkConditions(current, input);
      assertQuota(ctx, ns.owner_account_id, blob.size);
      const fileId =
        current && current.blob_hash !== null ? current.file_id : newId("fil");
      const seq = bumpSeq(ctx, nsId);
      const r = writeVersion(ctx, ns, path, blob, meta, fileId, seq);
      return { rev: String(r.rev), fileId, size: r.size, seq: String(seq) };
    });
    publish(ctx, nsId);
    return out;
  } finally {
    await blob.release();
    await ctx.blobs.flush();
  }
}

export async function putFile(
  ctx: Ctx,
  principal: Principal,
  nsId: string,
  path: string,
  input: { data: Uint8Array; meta: unknown } & Conditions,
): Promise<{ rev: string; fileId: string; size: number; seq: string }> {
  const { ns } = requireRole(ctx, principal, nsId, "editor");
  checkPath(path);
  if (input.data.byteLength > ctx.config.limits.maxFileBytes)
    throw tooLarge("file is too large");
  requireEpoch(input.data, ns.epoch, "content");
  const blob = await ctx.blobs.write(input.data);
  return commitBlob(ctx, principal, nsId, path, blob, input);
}

/** Tombstone a live path and file it in the trash (inside a transaction). */
function trashPath(
  ctx: Ctx,
  nsId: string,
  current: FileRow,
  seq: number,
): void {
  const now = ctx.clock.now();
  ctx.db.run(
    `INSERT INTO trash(namespace_id, file_id, path, rev, size, meta, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(namespace_id, file_id) DO UPDATE SET path = excluded.path, rev = excluded.rev,
       size = excluded.size, meta = excluded.meta, deleted_at = excluded.deleted_at`,
    nsId,
    current.file_id,
    current.path,
    current.rev,
    current.size,
    current.meta,
    now,
  );
  tombstone(ctx, nsId, current.path, seq);
}

function tombstone(ctx: Ctx, nsId: string, path: string, seq: number): void {
  ctx.db.run(
    `UPDATE files SET rev = ?, blob_hash = NULL, meta = NULL, size = 0, updated_at = ?
     WHERE namespace_id = ? AND path = ?`,
    seq,
    ctx.clock.now(),
    nsId,
    path,
  );
}

export async function deleteFile(
  ctx: Ctx,
  principal: Principal,
  nsId: string,
  path: string,
  cond: { ifMatch?: string },
): Promise<{ rev: string; seq: string }> {
  checkPath(path);
  const out = ctx.db.tx(() => {
    requireRole(ctx, principal, nsId, "editor");
    const current = liveRow(ctx, nsId, path);
    if (!current) throw notFound("no such file");
    checkConditions(current, cond);
    const seq = bumpSeq(ctx, nsId);
    trashPath(ctx, nsId, current, seq);
    return { rev: String(seq), seq: String(seq) };
  });
  publish(ctx, nsId);
  return out;
}

export async function moveFile(
  ctx: Ctx,
  principal: Principal,
  nsId: string,
  input: {
    from: string;
    to: string;
    meta: unknown;
    ifMatch?: string;
    overwrite?: boolean;
  },
): Promise<{ rev: string; fileId: string; seq: string }> {
  const from = checkPath(input.from, "from");
  const to = checkPath(input.to, "to");
  if (from === to) throw badRequest("from and to are the same path");
  const out = ctx.db.tx(() => {
    const { ns } = requireRole(ctx, principal, nsId, "editor");
    const meta = checkMetaHeader(ctx, input.meta, ns.epoch);
    const src = liveRow(ctx, nsId, from);
    if (!src) throw notFound("no such file");
    checkConditions(src, { ifMatch: input.ifMatch });
    const target = liveRow(ctx, nsId, to);
    if (target && !input.overwrite)
      throw conflict("target exists", { current: toEntry(target) });
    assertQuota(ctx, ns.owner_account_id, src.size);
    const seq = bumpSeq(ctx, nsId);
    if (target) trashPath(ctx, nsId, target, seq);
    tombstone(ctx, nsId, from, seq);
    writeVersion(
      ctx,
      ns,
      to,
      { hash: src.blob_hash!, size: src.size },
      meta,
      src.file_id,
      seq,
    );
    return { rev: String(seq), fileId: src.file_id, seq: String(seq) };
  });
  publish(ctx, nsId);
  await ctx.blobs.flush();
  return out;
}

export async function copyFile(
  ctx: Ctx,
  principal: Principal,
  nsId: string,
  input: { from: string; to: string; meta: unknown },
): Promise<{ rev: string; fileId: string; seq: string }> {
  const from = checkPath(input.from, "from");
  const to = checkPath(input.to, "to");
  const out = ctx.db.tx(() => {
    const { ns } = requireRole(ctx, principal, nsId, "editor");
    const meta = checkMetaHeader(ctx, input.meta, ns.epoch);
    const src = liveRow(ctx, nsId, from);
    if (!src) throw notFound("no such file");
    const target = liveRow(ctx, nsId, to);
    if (target) throw conflict("target exists", { current: toEntry(target) });
    assertQuota(ctx, ns.owner_account_id, src.size);
    const seq = bumpSeq(ctx, nsId);
    const fileId = newId("fil");
    writeVersion(
      ctx,
      ns,
      to,
      { hash: src.blob_hash!, size: src.size },
      meta,
      fileId,
      seq,
    );
    return { rev: String(seq), fileId, seq: String(seq) };
  });
  publish(ctx, nsId);
  return out;
}

// ---- history -----------------------------------------------------------------

export type RevisionEntry = {
  fileId: string;
  rev: string;
  path: string;
  size: number;
  meta: string | null;
  createdAt: number;
};

function toRevision(r: RevisionRow): RevisionEntry {
  return {
    fileId: r.file_id,
    rev: String(r.rev),
    path: r.path,
    size: r.size,
    meta: r.meta,
    createdAt: r.created_at,
  };
}

export function fileHistory(
  ctx: Ctx,
  principal: Principal,
  nsId: string,
  path: string,
): RevisionEntry[] {
  requireRole(ctx, principal, nsId, "viewer");
  const current = row(ctx, nsId, checkPath(path));
  if (!current) throw notFound("no such file");
  return ctx.db
    .all<RevisionRow>(
      "SELECT * FROM file_revisions WHERE namespace_id = ? AND file_id = ? ORDER BY rev DESC",
      nsId,
      current.file_id,
    )
    .map(toRevision);
}

function revisionRow(
  ctx: Ctx,
  nsId: string,
  fileId: string,
  rev: string,
): RevisionRow {
  const n = checkRev(rev, "rev");
  const r = ctx.db.get<RevisionRow>(
    "SELECT * FROM file_revisions WHERE namespace_id = ? AND file_id = ? AND rev = ?",
    nsId,
    fileId,
    n ?? -1,
  );
  if (!r) throw notFound("no such revision");
  return r;
}

export function readRevision(
  ctx: Ctx,
  principal: Principal,
  nsId: string,
  fileId: string,
  rev: string,
): Readable {
  requireRole(ctx, principal, nsId, "viewer");
  const r = revisionRow(ctx, nsId, fileId, rev);
  const stream = ctx.blobs.store.stream(r.blob_hash);
  if (!stream) throw new Error(`blob ${r.blob_hash} missing`);
  return stream;
}

/** Make an old revision the current version of the (live) file at `path`. */
export async function restoreRevision(
  ctx: Ctx,
  principal: Principal,
  nsId: string,
  input: { path: string; rev: string; meta: unknown; ifMatch?: string },
): Promise<{ rev: string; fileId: string; seq: string }> {
  const path = checkPath(input.path);
  const out = ctx.db.tx(() => {
    const { ns } = requireRole(ctx, principal, nsId, "editor");
    const meta = checkMetaHeader(ctx, input.meta, ns.epoch);
    const current = liveRow(ctx, nsId, path);
    if (!current) throw notFound("no such file");
    checkConditions(current, { ifMatch: input.ifMatch });
    const old = revisionRow(ctx, nsId, current.file_id, input.rev);
    assertQuota(ctx, ns.owner_account_id, old.size);
    const seq = bumpSeq(ctx, nsId);
    writeVersion(
      ctx,
      ns,
      path,
      { hash: old.blob_hash, size: old.size },
      meta,
      current.file_id,
      seq,
    );
    return { rev: String(seq), fileId: current.file_id, seq: String(seq) };
  });
  publish(ctx, nsId);
  await ctx.blobs.flush();
  return out;
}

// ---- trash ---------------------------------------------------------------------

export type TrashEntry = {
  fileId: string;
  path: string;
  rev: string;
  size: number;
  meta: string | null;
  deletedAt: number;
};

export function listTrash(
  ctx: Ctx,
  principal: Principal,
  nsId: string,
): TrashEntry[] {
  requireRole(ctx, principal, nsId, "viewer");
  return ctx.db
    .all<{
      file_id: string;
      path: string;
      rev: number;
      size: number;
      meta: string | null;
      deleted_at: number;
    }>(
      "SELECT * FROM trash WHERE namespace_id = ? ORDER BY deleted_at DESC",
      nsId,
    )
    .map((r) => ({
      fileId: r.file_id,
      path: r.path,
      rev: String(r.rev),
      size: r.size,
      meta: r.meta,
      deletedAt: r.deleted_at,
    }));
}

export async function restoreTrash(
  ctx: Ctx,
  principal: Principal,
  nsId: string,
  input: { fileId: string; path?: string; meta?: unknown },
): Promise<{ rev: string; fileId: string; path: string; seq: string }> {
  const out = ctx.db.tx(() => {
    const { ns } = requireRole(ctx, principal, nsId, "editor");
    const t = ctx.db.get<{
      file_id: string;
      path: string;
      rev: number;
      meta: string | null;
    }>(
      "SELECT * FROM trash WHERE namespace_id = ? AND file_id = ?",
      nsId,
      input.fileId,
    );
    if (!t) throw notFound("not in trash");
    const path = input.path !== undefined ? checkPath(input.path) : t.path;
    const meta =
      input.meta !== undefined
        ? checkMetaHeader(ctx, input.meta, ns.epoch)
        : path === t.path && t.meta !== null
          ? t.meta
          : (() => {
              throw badRequest(
                "meta is required when restoring to another path",
              );
            })();
    if (liveRow(ctx, nsId, path)) throw conflict("a file exists at that path");
    const last = revisionRow(ctx, nsId, t.file_id, String(t.rev));
    ctx.db.run(
      "DELETE FROM trash WHERE namespace_id = ? AND file_id = ?",
      nsId,
      t.file_id,
    );
    const seq = bumpSeq(ctx, nsId);
    writeVersion(
      ctx,
      ns,
      path,
      { hash: last.blob_hash, size: last.size },
      meta,
      t.file_id,
      seq,
    );
    return { rev: String(seq), fileId: t.file_id, path, seq: String(seq) };
  });
  publish(ctx, nsId);
  return out;
}

/** Permanently delete a trashed file and all its history. */
export async function purgeTrash(
  ctx: Ctx,
  principal: Principal | null,
  nsId: string,
  fileId: string,
): Promise<void> {
  ctx.db.tx(() => {
    if (principal) requireRole(ctx, principal, nsId, "editor");
    const t = ctx.db.get(
      "SELECT 1 FROM trash WHERE namespace_id = ? AND file_id = ?",
      nsId,
      fileId,
    );
    if (!t) throw notFound("not in trash");
    ctx.db.run(
      "DELETE FROM trash WHERE namespace_id = ? AND file_id = ?",
      nsId,
      fileId,
    );
    const live = ctx.db.get(
      "SELECT 1 FROM files WHERE namespace_id = ? AND file_id = ? AND blob_hash IS NOT NULL",
      nsId,
      fileId,
    );
    if (live) return; // restored elsewhere meanwhile; keep its history
    for (const r of ctx.db.all<RevisionRow>(
      "SELECT * FROM file_revisions WHERE namespace_id = ? AND file_id = ?",
      nsId,
      fileId,
    )) {
      dropRevision(ctx, nsId, r);
    }
  });
  await ctx.blobs.flush();
}
