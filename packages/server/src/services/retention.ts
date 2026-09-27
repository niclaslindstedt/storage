// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Periodic housekeeping: purge old trash, prune history past its window,
// drop tombstones past the feed horizon (advancing `purged_seq`), expire
// uploads, tokens, challenges and pairings, and remove unreferenced blobs.

import type { Ctx } from "../context.ts";
import { pruneHistory, purgeTrash } from "./files.ts";
import { prunePairings } from "./pairing.ts";
import { dropUpload } from "./uploads.ts";

const DAY = 24 * 3600_000;

export type RetentionReport = {
  trashPurged: number;
  tombstonesPurged: number;
  uploadsExpired: number;
};

export async function runRetention(ctx: Ctx): Promise<RetentionReport> {
  const now = ctx.clock.now();
  const { trashDays, historyDays, tombstoneDays } = ctx.config.retention;

  const trash = ctx.db.all<{ namespace_id: string; file_id: string }>(
    "SELECT namespace_id, file_id FROM trash WHERE deleted_at < ?",
    now - trashDays * DAY,
  );
  for (const t of trash) await purgeTrash(ctx, null, t.namespace_id, t.file_id);

  ctx.db.tx(() => {
    for (const f of ctx.db.all<{ namespace_id: string; file_id: string }>(
      "SELECT DISTINCT namespace_id, file_id FROM file_revisions WHERE created_at < ?",
      now - historyDays * DAY,
    )) {
      pruneHistory(ctx, f.namespace_id, f.file_id);
    }
  });

  const horizon = now - tombstoneDays * DAY;
  let tombstones = 0;
  ctx.db.tx(() => {
    const rows = ctx.db.all<{ namespace_id: string; rev: number }>(
      `SELECT namespace_id, MAX(rev) AS rev FROM (
         SELECT namespace_id, rev FROM records WHERE value IS NULL AND updated_at < ?
         UNION ALL
         SELECT namespace_id, rev FROM files WHERE blob_hash IS NULL AND updated_at < ?
       ) GROUP BY namespace_id`,
      horizon,
      horizon,
    );
    for (const r of rows) {
      ctx.db.run(
        "UPDATE namespaces SET purged_seq = MAX(purged_seq, ?) WHERE id = ?",
        r.rev,
        r.namespace_id,
      );
    }
    tombstones += ctx.db.run(
      "DELETE FROM records WHERE value IS NULL AND updated_at < ?",
      horizon,
    ).changes;
    tombstones += ctx.db.run(
      "DELETE FROM files WHERE blob_hash IS NULL AND updated_at < ?",
      horizon,
    ).changes;
  });

  const uploads = ctx.db.all<{ id: string }>(
    "SELECT id FROM uploads WHERE expires_at < ?",
    now,
  );
  for (const u of uploads) await dropUpload(ctx, u.id);

  ctx.db.run("DELETE FROM tokens WHERE expires_at < ?", now);
  ctx.db.run("DELETE FROM challenges WHERE expires_at < ?", now);
  prunePairings(ctx);
  await ctx.blobs.flush();

  return {
    trashPurged: trash.length,
    tombstonesPurged: tombstones,
    uploadsExpired: uploads.length,
  };
}
