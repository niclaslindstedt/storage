// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// A thin, typed wrapper over `node:sqlite`: pragmas for durability and
// integrity, forward-only migrations, and transactions that nest as
// savepoints. Synchronous by design — one process owns the database, and a
// synchronous transaction can never interleave with another request.

import { DatabaseSync, type SQLInputValue } from "node:sqlite";

import { MIGRATIONS } from "./schema.ts";

export type SqlValue = SQLInputValue;

export interface Db {
  run(sql: string, ...params: SqlValue[]): { changes: number };
  get<T = Record<string, unknown>>(
    sql: string,
    ...params: SqlValue[]
  ): T | undefined;
  all<T = Record<string, unknown>>(sql: string, ...params: SqlValue[]): T[];
  exec(sql: string): void;
  /** Run `fn` atomically. Nested calls become savepoints. */
  tx<T>(fn: () => T): T;
  schemaVersion(): number;
  close(): void;
  readonly path: string;
}

export function openDatabase(path: string): Db {
  const raw = new DatabaseSync(path);
  raw.exec("PRAGMA foreign_keys = ON");
  raw.exec("PRAGMA busy_timeout = 5000");
  if (path !== ":memory:") {
    raw.exec("PRAGMA journal_mode = WAL");
    raw.exec("PRAGMA synchronous = FULL");
  }
  raw.exec("PRAGMA secure_delete = ON");

  const statements = new Map<string, ReturnType<DatabaseSync["prepare"]>>();
  function stmt(sql: string) {
    let s = statements.get(sql);
    if (!s) {
      s = raw.prepare(sql);
      statements.set(sql, s);
    }
    return s;
  }

  let depth = 0;
  const db: Db = {
    path,
    run(sql, ...params) {
      const r = stmt(sql).run(...params);
      return { changes: Number(r.changes) };
    },
    get<T>(sql: string, ...params: SqlValue[]) {
      return stmt(sql).get(...params) as T | undefined;
    },
    all<T>(sql: string, ...params: SqlValue[]) {
      return stmt(sql).all(...params) as T[];
    },
    exec(sql) {
      raw.exec(sql);
    },
    tx<T>(fn: () => T): T {
      const name = `sp${depth}`;
      raw.exec(depth === 0 ? "BEGIN IMMEDIATE" : `SAVEPOINT ${name}`);
      depth++;
      try {
        const out = fn();
        depth--;
        raw.exec(depth === 0 ? "COMMIT" : `RELEASE ${name}`);
        return out;
      } catch (err) {
        depth--;
        if (depth === 0) raw.exec("ROLLBACK");
        else raw.exec(`ROLLBACK TO ${name}; RELEASE ${name}`);
        throw err;
      }
    },
    schemaVersion() {
      return Number(
        (raw.prepare("PRAGMA user_version").get() as { user_version: number })
          .user_version,
      );
    },
    close() {
      statements.clear();
      raw.close();
    },
  };

  migrate(db);
  return db;
}

function migrate(db: Db): void {
  const current = db.schemaVersion();
  if (current > MIGRATIONS.length) {
    throw new Error(
      `database schema v${current} is newer than this server (v${MIGRATIONS.length}); upgrade the server`,
    );
  }
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.tx(() => {
      db.exec(MIGRATIONS[v]!);
      db.exec(`PRAGMA user_version = ${v + 1}`);
    });
  }
}
