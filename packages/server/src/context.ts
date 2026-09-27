// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Everything a service needs, created once per server: database, blobs,
// clock, config, events, audit log and logger.

import { join } from "node:path";
import { mkdirSync } from "node:fs";

import { AuditLog } from "./audit.ts";
import { BlobRefs } from "./blob-refs.ts";
import {
  type BlobStore,
  createFsBlobStore,
  createMemoryBlobStore,
} from "./blobs.ts";
import type { ServerConfig } from "./config.ts";
import { type Db, openDatabase } from "./db/database.ts";
import { EventHub } from "./events.ts";
import { createMemoryLogger, type Logger } from "./log.ts";
import { type Clock, systemClock } from "./util/clock.ts";
import { newId } from "./util/random.ts";

export type Ctx = {
  readonly config: ServerConfig;
  readonly db: Db;
  readonly blobs: BlobRefs;
  readonly clock: Clock;
  readonly events: EventHub;
  readonly audit: AuditLog;
  readonly log: Logger;
  readonly serverId: string;
};

export type ContextDeps = {
  clock?: Clock;
  log?: Logger;
  db?: Db;
  blobStore?: BlobStore;
};

export function createContext(
  config: ServerConfig,
  deps: ContextDeps = {},
): Ctx {
  const clock = deps.clock ?? systemClock;
  let db = deps.db;
  let blobStore = deps.blobStore;
  if (config.dataDir) {
    mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
    db ??= openDatabase(join(config.dataDir, "storage.db"));
    blobStore ??= createFsBlobStore(join(config.dataDir, "blobs"));
  } else {
    db ??= openDatabase(":memory:");
    blobStore ??= createMemoryBlobStore();
  }
  const serverId = ensureServerId(db);
  return {
    config,
    db,
    blobs: new BlobRefs(db, blobStore, clock),
    clock,
    events: new EventHub(),
    audit: new AuditLog(db, clock),
    log: deps.log ?? createMemoryLogger(),
    serverId,
  };
}

function ensureServerId(db: Db): string {
  const row = db.get<{ value: string }>(
    "SELECT value FROM settings WHERE key = 'server_id'",
  );
  if (row) return row.value;
  const id = newId("srv");
  db.run("INSERT INTO settings(key, value) VALUES ('server_id', ?)", id);
  return id;
}

export function getSetting(ctx: Ctx, key: string): string | null {
  return (
    ctx.db.get<{ value: string }>(
      "SELECT value FROM settings WHERE key = ?",
      key,
    )?.value ?? null
  );
}

export function setSetting(ctx: Ctx, key: string, value: string): void {
  ctx.db.run(
    "INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    key,
    value,
  );
}
