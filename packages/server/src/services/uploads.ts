// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Multi-part uploads for large files (photos, attachments, archives): parts
// are stored as blobs, then joined in order and committed like a normal
// conditional write. An upload that is never committed expires.

import type { Ctx } from "../context.ts";
import { requireEpoch } from "../envelope.ts";
import { badRequest, notFound, tooLarge } from "../errors.ts";
import { checkPath } from "../validate.ts";
import { newId } from "../util/random.ts";
import { commitBlob } from "./files.ts";
import { requireRole } from "./namespaces.ts";
import type { Principal } from "./principal.ts";

const MAX_PARTS = 10_000;

type UploadRow = {
  id: string;
  namespace_id: string;
  account_id: string;
  size: number;
  expires_at: number;
};

function uploadRow(
  ctx: Ctx,
  principal: Principal,
  nsId: string,
  uploadId: string,
): UploadRow {
  requireRole(ctx, principal, nsId, "editor");
  const u = ctx.db.get<UploadRow>(
    "SELECT * FROM uploads WHERE id = ? AND namespace_id = ? AND account_id = ?",
    uploadId,
    nsId,
    principal.accountId,
  );
  if (!u || u.expires_at < ctx.clock.now()) throw notFound("no such upload");
  return u;
}

export function createUpload(
  ctx: Ctx,
  principal: Principal,
  nsId: string,
): { uploadId: string; expiresAt: number } {
  requireRole(ctx, principal, nsId, "editor");
  const id = newId("upl");
  const now = ctx.clock.now();
  const expiresAt = now + ctx.config.ttl.uploadSeconds * 1000;
  ctx.db.run(
    "INSERT INTO uploads(id, namespace_id, account_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)",
    id,
    nsId,
    principal.accountId,
    now,
    expiresAt,
  );
  return { uploadId: id, expiresAt };
}

export async function putPart(
  ctx: Ctx,
  principal: Principal,
  nsId: string,
  uploadId: string,
  n: number,
  data: Uint8Array,
): Promise<{ n: number; size: number }> {
  if (!Number.isSafeInteger(n) || n < 1 || n > MAX_PARTS)
    throw badRequest(`part number must be 1-${MAX_PARTS}`);
  if (data.byteLength === 0) throw badRequest("part is empty");
  if (data.byteLength > ctx.config.limits.maxPartBytes)
    throw tooLarge("part is too large");
  uploadRow(ctx, principal, nsId, uploadId);
  const blob = await ctx.blobs.write(data);
  try {
    ctx.db.tx(() => {
      const u = uploadRow(ctx, principal, nsId, uploadId);
      const old = ctx.db.get<{ blob_hash: string; size: number }>(
        "SELECT blob_hash, size FROM upload_parts WHERE upload_id = ? AND n = ?",
        uploadId,
        n,
      );
      const total = u.size - (old?.size ?? 0) + blob.size;
      if (total > ctx.config.limits.maxFileBytes)
        throw tooLarge("upload is too large");
      if (old) ctx.blobs.unref(old.blob_hash);
      ctx.db.run(
        `INSERT INTO upload_parts(upload_id, n, blob_hash, size) VALUES (?, ?, ?, ?)
         ON CONFLICT(upload_id, n) DO UPDATE SET blob_hash = excluded.blob_hash, size = excluded.size`,
        uploadId,
        n,
        blob.hash,
        blob.size,
      );
      ctx.blobs.ref(blob.hash, blob.size);
      ctx.db.run("UPDATE uploads SET size = ? WHERE id = ?", total, uploadId);
    });
  } finally {
    await blob.release();
    await ctx.blobs.flush();
  }
  return { n, size: blob.size };
}

export async function commitUpload(
  ctx: Ctx,
  principal: Principal,
  nsId: string,
  uploadId: string,
  input: {
    path: string;
    meta: unknown;
    ifMatch?: string;
    ifNoneMatch?: boolean;
  },
): Promise<{ rev: string; fileId: string; size: number; seq: string }> {
  const path = checkPath(input.path);
  const { ns } = requireRole(ctx, principal, nsId, "editor");
  uploadRow(ctx, principal, nsId, uploadId);
  const parts = ctx.db.all<{ n: number; blob_hash: string }>(
    "SELECT n, blob_hash FROM upload_parts WHERE upload_id = ? ORDER BY n",
    uploadId,
  );
  if (parts.length === 0) throw badRequest("upload has no parts");
  parts.forEach((p, i) => {
    if (p.n !== i + 1) throw badRequest(`part ${i + 1} is missing`);
  });
  const first = await ctx.blobs.store.read(parts[0]!.blob_hash);
  requireEpoch(first ?? new Uint8Array(), ns.epoch, "content");
  const blob = await ctx.blobs.concat(parts.map((p) => p.blob_hash));
  const out = await commitBlob(ctx, principal, nsId, path, blob, input);
  await dropUpload(ctx, uploadId);
  return out;
}

export async function abortUpload(
  ctx: Ctx,
  principal: Principal,
  nsId: string,
  uploadId: string,
): Promise<void> {
  uploadRow(ctx, principal, nsId, uploadId);
  await dropUpload(ctx, uploadId);
}

export async function dropUpload(ctx: Ctx, uploadId: string): Promise<void> {
  ctx.db.tx(() => {
    for (const p of ctx.db.all<{ blob_hash: string }>(
      "SELECT blob_hash FROM upload_parts WHERE upload_id = ?",
      uploadId,
    )) {
      ctx.blobs.unref(p.blob_hash);
    }
    ctx.db.run("DELETE FROM uploads WHERE id = ?", uploadId);
  });
  await ctx.blobs.flush();
}
