// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The in-memory log the admin console shows (SPEC §11.1): a ring buffer of
// structured entries fed by `teeLogger`, which wraps the process logger so
// every line still reaches stderr and the debug log file. Subscribers get
// new entries as they happen (the console's live tail).

import type { Logger } from "../log.ts";
import { type Clock, systemClock } from "../util/clock.ts";

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogEntry = {
  seq: number;
  at: number;
  level: LogLevel;
  message: string;
};

export type LogQuery = {
  /** Only entries with a higher sequence number. */
  after?: number;
  /** Minimum level. */
  level?: LogLevel;
  /** Case-insensitive substring. */
  q?: string;
  /** Newest N of the matches. */
  limit?: number;
};

const RANK: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

export const LOG_LEVELS = Object.keys(RANK) as LogLevel[];

function describe(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return err === undefined ? "" : String(err);
}

export class LogBuffer {
  private readonly entries: LogEntry[] = [];
  private readonly listeners = new Set<(e: LogEntry) => void>();
  private readonly capacity: number;
  private readonly clock: Clock;
  private seq = 0;
  private readonly problems = { warn: 0, error: 0 };

  constructor(opts: { capacity?: number; clock?: Clock } = {}) {
    this.capacity = opts.capacity ?? 2000;
    this.clock = opts.clock ?? systemClock;
  }

  push(level: LogLevel, message: string): LogEntry {
    const entry = { seq: ++this.seq, at: this.clock.now(), level, message };
    this.entries.push(entry);
    if (this.entries.length > this.capacity) this.entries.shift();
    if (level === "warn" || level === "error") this.problems[level]++;
    for (const fn of this.listeners) {
      try {
        fn(entry);
      } catch {
        // a broken subscriber must never break logging
      }
    }
    return entry;
  }

  list(query: LogQuery = {}): LogEntry[] {
    const min = RANK[query.level ?? "debug"];
    const q = query.q?.toLowerCase();
    const out = this.entries.filter(
      (e) =>
        e.seq > (query.after ?? 0) &&
        RANK[e.level] >= min &&
        (!q || e.message.toLowerCase().includes(q)),
    );
    return query.limit !== undefined ? out.slice(-query.limit) : out;
  }

  subscribe(fn: (e: LogEntry) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  get subscribers(): number {
    return this.listeners.size;
  }

  /** Warnings and errors logged since start (including evicted ones). */
  counts(): { warn: number; error: number } {
    return { ...this.problems };
  }
}

/** A logger that forwards to `inner` and records every line in `buffer`. */
export function teeLogger(inner: Logger, buffer: LogBuffer): Logger {
  const withErr = (message: string, err?: unknown) =>
    err === undefined ? message : `${message} (${describe(err)})`;
  return {
    header(message) {
      buffer.push("info", message);
      inner.header(message);
    },
    status(message) {
      buffer.push("info", message);
      inner.status(message);
    },
    info(message) {
      buffer.push("info", message);
      inner.info(message);
    },
    warn(message, err) {
      buffer.push("warn", withErr(message, err));
      inner.warn(message, err);
    },
    error(message, err) {
      buffer.push("error", withErr(message, err));
      inner.error(message, err);
    },
    debug(message) {
      buffer.push("debug", message);
      inner.debug(message);
    },
  };
}
