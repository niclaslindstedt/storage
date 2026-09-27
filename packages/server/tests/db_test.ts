import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { openDatabase } from "../src/db/database.ts";
import { MIGRATIONS } from "../src/db/schema.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("openDatabase", () => {
  it("applies every migration and records the schema version", () => {
    const db = openDatabase(":memory:");
    expect(db.schemaVersion()).toBe(MIGRATIONS.length);
    const tables = db
      .all<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
      )
      .map((r) => r.name);
    for (const t of [
      "accounts",
      "devices",
      "tokens",
      "pairings",
      "namespaces",
      "members",
      "key_wraps",
      "invites",
      "files",
      "file_revisions",
      "trash",
      "records",
      "blobs",
      "uploads",
      "upload_parts",
      "audit",
      "origins",
      "settings",
    ]) {
      expect(tables).toContain(t);
    }
    db.close();
  });

  it("is idempotent when reopened on disk and uses WAL", () => {
    const dir = mkdtempSync(join(tmpdir(), "storage-db-"));
    dirs.push(dir);
    const file = join(dir, "storage.db");
    const a = openDatabase(file);
    a.run("INSERT INTO settings(key, value) VALUES (?, ?)", "k", "v");
    expect(a.get<{ journal_mode: string }>("PRAGMA journal_mode")).toEqual({
      journal_mode: "wal",
    });
    a.close();
    const b = openDatabase(file);
    expect(b.schemaVersion()).toBe(MIGRATIONS.length);
    expect(
      b.get<{ value: string }>("SELECT value FROM settings WHERE key='k'"),
    ).toEqual({ value: "v" });
    b.close();
  });

  it("rolls a transaction back when the callback throws", () => {
    const db = openDatabase(":memory:");
    expect(() =>
      db.tx(() => {
        db.run("INSERT INTO settings(key, value) VALUES ('a', '1')");
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(db.get("SELECT * FROM settings WHERE key='a'")).toBeUndefined();
  });

  it("nests transactions as savepoints", () => {
    const db = openDatabase(":memory:");
    db.tx(() => {
      db.run("INSERT INTO settings(key, value) VALUES ('outer', '1')");
      try {
        db.tx(() => {
          db.run("INSERT INTO settings(key, value) VALUES ('inner', '1')");
          throw new Error("inner fails");
        });
      } catch {
        // inner rolled back; outer continues
      }
    });
    expect(db.get("SELECT key FROM settings WHERE key='outer'")).toEqual({
      key: "outer",
    });
    expect(db.get("SELECT key FROM settings WHERE key='inner'")).toBeUndefined();
  });

  it("enforces foreign keys", () => {
    const db = openDatabase(":memory:");
    expect(() =>
      db.run(
        "INSERT INTO devices(id, account_id, name, platform, dsk_public, dek_public, created_at) VALUES ('d','missing','n','web','x','y',0)",
      ),
    ).toThrow();
  });
});
