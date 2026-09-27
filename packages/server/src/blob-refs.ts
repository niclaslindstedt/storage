// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Reference counting for content-addressed blobs. Bytes are written to the
// blob store *before* the database transaction that references them (a
// transaction must stay synchronous), so a blob can briefly exist with no
// reference. Pins make that window safe: a pinned hash is never collected,
// and when a write's transaction fails its unreferenced blob is removed once
// the last pin goes.

import type { BlobInfo, BlobStore } from "./blobs.ts";
import type { Db } from "./db/database.ts";
import type { Clock } from "./util/clock.ts";

export type PinnedBlob = BlobInfo & { release(): Promise<void> };

export class BlobRefs {
  private readonly pins = new Map<string, number>();
  private readonly candidates = new Set<string>();

  constructor(
    private readonly db: Db,
    readonly store: BlobStore,
    private readonly clock: Clock,
  ) {}

  /** Write bytes and pin them until `release()`. */
  async write(data: Uint8Array): Promise<PinnedBlob> {
    const info = await this.store.write(data);
    return this.pinned(info);
  }

  /** Concatenate stored blobs into a new pinned blob. */
  async concat(hashes: readonly string[]): Promise<PinnedBlob> {
    const info = await this.store.concat(hashes);
    return this.pinned(info);
  }

  private pinned(info: BlobInfo): PinnedBlob {
    this.pins.set(info.hash, (this.pins.get(info.hash) ?? 0) + 1);
    let released = false;
    return {
      ...info,
      release: async () => {
        if (released) return;
        released = true;
        const n = (this.pins.get(info.hash) ?? 1) - 1;
        if (n <= 0) this.pins.delete(info.hash);
        else this.pins.set(info.hash, n);
        this.candidates.add(info.hash);
        await this.flush();
      },
    };
  }

  /** Add a reference (inside a transaction). */
  ref(hash: string, size: number): void {
    this.db.run(
      `INSERT INTO blobs(hash, size, refs, created_at) VALUES (?, ?, 1, ?)
       ON CONFLICT(hash) DO UPDATE SET refs = refs + 1`,
      hash,
      size,
      this.clock.now(),
    );
  }

  /** Drop a reference (inside a transaction); collected by `flush()`. */
  unref(hash: string): void {
    this.db.run("UPDATE blobs SET refs = refs - 1 WHERE hash = ?", hash);
    this.db.run("DELETE FROM blobs WHERE hash = ? AND refs <= 0", hash);
    this.candidates.add(hash);
  }

  /** Remove bytes whose last reference went away (after the transaction). */
  async flush(): Promise<void> {
    const hashes = [...this.candidates];
    this.candidates.clear();
    for (const hash of hashes) {
      if (this.pins.has(hash)) continue;
      const row = this.db.get("SELECT 1 FROM blobs WHERE hash = ?", hash);
      if (!row) await this.store.remove(hash);
    }
  }

  /** Remove stored bytes no row references (crash leftovers). */
  async sweepOrphans(): Promise<number> {
    let removed = 0;
    for await (const hash of this.store.list()) {
      if (this.pins.has(hash)) continue;
      if (!this.db.get("SELECT 1 FROM blobs WHERE hash = ?", hash)) {
        await this.store.remove(hash);
        removed++;
      }
    }
    return removed;
  }
}
