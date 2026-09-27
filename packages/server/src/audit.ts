// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Tamper-evident audit log. Each entry's hash covers the previous entry's
// hash, so editing, deleting or reordering any entry breaks every hash after
// it — `verify()` finds the first break. What is logged: who (account /
// device / "cli"), did what, to which object, from where. Never content.

import type { Db } from "./db/database.ts";
import { sha256Hex } from "./util/random.ts";
import type { Clock } from "./util/clock.ts";

export type AuditInput = {
  actor: string | null;
  action: string;
  target?: string | null;
  ip?: string | null;
  detail?: Record<string, unknown> | null;
};

export type AuditEntry = {
  id: number;
  at: number;
  actor: string | null;
  action: string;
  target: string | null;
  ip: string | null;
  detail: string | null;
  prevHash: string;
  hash: string;
};

const GENESIS = "0".repeat(64);

function entryHash(
  prev: string,
  at: number,
  actor: string | null,
  action: string,
  target: string | null,
  ip: string | null,
  detail: string | null,
): string {
  return sha256Hex(
    JSON.stringify([prev, at, actor, action, target, ip, detail]),
  );
}

export class AuditLog {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
  ) {}

  append(input: AuditInput): void {
    this.db.tx(() => {
      const last = this.db.get<{ hash: string }>(
        "SELECT hash FROM audit ORDER BY id DESC LIMIT 1",
      );
      const prev = last?.hash ?? GENESIS;
      const at = this.clock.now();
      const detail = input.detail ? JSON.stringify(input.detail) : null;
      const target = input.target ?? null;
      const ip = input.ip ?? null;
      const hash = entryHash(
        prev,
        at,
        input.actor,
        input.action,
        target,
        ip,
        detail,
      );
      this.db.run(
        "INSERT INTO audit(at, actor, action, target, ip, detail, prev_hash, hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        at,
        input.actor,
        input.action,
        target,
        ip,
        detail,
        prev,
        hash,
      );
    });
  }

  list(sinceId = 0, limit = 200): AuditEntry[] {
    return this.db
      .all<{
        id: number;
        at: number;
        actor: string | null;
        action: string;
        target: string | null;
        ip: string | null;
        detail: string | null;
        prev_hash: string;
        hash: string;
      }>("SELECT * FROM audit WHERE id > ? ORDER BY id LIMIT ?", sinceId, limit)
      .map((r) => ({
        id: r.id,
        at: r.at,
        actor: r.actor,
        action: r.action,
        target: r.target,
        ip: r.ip,
        detail: r.detail,
        prevHash: r.prev_hash,
        hash: r.hash,
      }));
  }

  /** The newest entry's hash — the value to anchor elsewhere. */
  head(): string {
    return (
      this.db.get<{ hash: string }>(
        "SELECT hash FROM audit ORDER BY id DESC LIMIT 1",
      )?.hash ?? GENESIS
    );
  }

  /** Recompute the chain. `brokenAt` is the id of the first bad entry. */
  verify(): { ok: boolean; count: number; brokenAt: number | null } {
    let prev = GENESIS;
    let count = 0;
    let after = 0;
    for (;;) {
      const page = this.list(after, 1000);
      if (page.length === 0) break;
      for (const e of page) {
        const expected = entryHash(
          prev,
          e.at,
          e.actor,
          e.action,
          e.target,
          e.ip,
          e.detail,
        );
        if (e.prevHash !== prev || e.hash !== expected) {
          return { ok: false, count, brokenAt: e.id };
        }
        prev = e.hash;
        count++;
        after = e.id;
      }
    }
    return { ok: true, count, brokenAt: null };
  }
}
