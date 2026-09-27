// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The change feed (SPEC §6.6). Every mutation stamps the item with the
// namespace's next `seq`, so "what changed since S" is a range query over
// items stamped after S. Deletions stay visible as tombstones until
// retention purges them; a cursor older than the purge horizon gets 410 and
// the client does a full resync.

import type { Ctx } from "../context.ts";
import { badRequest, gone } from "../errors.ts";
import { toB64u } from "../util/b64.ts";
import { getNamespaceRow, requireRole } from "./namespaces.ts";
import type { Principal } from "./principal.ts";

export type Change =
  | {
      kind: "file";
      path: string;
      fileId: string;
      rev: string;
      size: number;
      meta: string | null;
      deleted: boolean;
    }
  | {
      kind: "record";
      collection: string;
      key: string;
      rev: string;
      value: string | null;
      deleted: boolean;
    }
  | { kind: "namespace"; rev: string; meta: string; epoch: number }
  | { kind: "members"; rev: string };

type Item = { rev: number; bytes: number; change: Change };

function fetchItems(
  ctx: Ctx,
  nsId: string,
  since: number,
  upTo: number | null,
  limit: number,
): Item[] {
  const bound = upTo === null ? "" : "AND rev <= ?";
  const args = (extra: number[]) =>
    upTo === null ? [nsId, since, ...extra] : [nsId, since, upTo, ...extra];
  const files = ctx.db
    .all<{
      path: string;
      file_id: string;
      rev: number;
      size: number;
      blob_hash: string | null;
      meta: string | null;
    }>(
      `SELECT path, file_id, rev, size, blob_hash, meta FROM files
       WHERE namespace_id = ? AND rev > ? ${bound} ORDER BY rev LIMIT ?`,
      ...args([limit]),
    )
    .map<Item>((r) => ({
      rev: r.rev,
      bytes: 200 + (r.meta?.length ?? 0),
      change: {
        kind: "file",
        path: r.path,
        fileId: r.file_id,
        rev: String(r.rev),
        size: r.size,
        meta: r.meta,
        deleted: r.blob_hash === null,
      },
    }));
  const records = ctx.db
    .all<{
      collection: string;
      key: string;
      rev: number;
      value: Uint8Array | null;
    }>(
      `SELECT collection, key, rev, value FROM records
       WHERE namespace_id = ? AND rev > ? ${bound} ORDER BY rev LIMIT ?`,
      ...args([limit]),
    )
    .map<Item>((r) => {
      const value = r.value === null ? null : toB64u(new Uint8Array(r.value));
      return {
        rev: r.rev,
        bytes: 200 + (value?.length ?? 0),
        change: {
          kind: "record",
          collection: r.collection,
          key: r.key,
          rev: String(r.rev),
          value,
          deleted: value === null,
        },
      };
    });
  const ns = getNamespaceRow(ctx, nsId)!;
  const extra: Item[] = [];
  const inRange = (rev: number) =>
    rev > since && (upTo === null || rev <= upTo);
  if (inRange(ns.meta_rev)) {
    extra.push({
      rev: ns.meta_rev,
      bytes: 200 + ns.meta.length,
      change: {
        kind: "namespace",
        rev: String(ns.meta_rev),
        meta: ns.meta,
        epoch: ns.epoch,
      },
    });
  }
  if (inRange(ns.members_rev)) {
    extra.push({
      rev: ns.members_rev,
      bytes: 50,
      change: { kind: "members", rev: String(ns.members_rev) },
    });
  }
  return [...files, ...records, ...extra].sort((a, b) => a.rev - b.rev);
}

export async function changes(
  ctx: Ctx,
  principal: Principal,
  nsId: string,
  opts: {
    since: string;
    limit?: number;
    waitMs?: number;
    signal?: AbortSignal;
  },
): Promise<{ seq: string; changes: Change[]; more: boolean }> {
  if (!/^\d{1,15}$/.test(opts.since))
    throw badRequest("since must be a sequence number");
  const since = Number(opts.since);
  const limit = Math.min(Math.max(opts.limit ?? 500, 1), 5000);

  const read = () => {
    const { ns } = requireRole(ctx, principal, nsId, "viewer");
    if (since < ns.purged_seq) {
      throw gone("the change feed no longer reaches that far back; resync", {
        seq: String(ns.seq),
      });
    }
    if (since > ns.seq) {
      throw gone("cursor is ahead of the server; resync", {
        seq: String(ns.seq),
        reason: "ahead",
      });
    }
    const items = fetchItems(ctx, nsId, since, null, limit + 1);
    if (items.length === 0)
      return { seq: String(ns.seq), changes: [], more: false };
    // Cut at `limit` items or the byte budget, never inside one seq group.
    let cut = 0;
    let bytes = 0;
    while (
      cut < items.length &&
      cut < limit &&
      bytes < ctx.config.limits.maxFeedBytes
    ) {
      bytes += items[cut]!.bytes;
      cut++;
    }
    const lastRev = items[cut - 1]!.rev;
    const page = fetchItems(ctx, nsId, since, lastRev, 1_000_000);
    const more =
      page.length < items.length || lastRev < ns.seq
        ? fetchItems(ctx, nsId, lastRev, null, 1).length > 0
        : false;
    return {
      seq: more ? String(lastRev) : String(ns.seq),
      changes: page.map((i) => i.change),
      more,
    };
  };

  const first = read();
  const wait = Math.min(opts.waitMs ?? 0, 30_000);
  if (first.changes.length > 0 || wait <= 0) return first;
  await ctx.events.waitForNs(nsId, Number(first.seq), wait, opts.signal);
  return read();
}
