// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// A consistent copy of the data directory: the database via `VACUUM INTO`
// (safe while the server runs), then the content-addressed blobs (immutable,
// so a plain copy is consistent with the snapshot), TLS material and
// config.json. The admin token is deliberately not copied.

import { cpSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join, resolve, sep } from "node:path";

import type { Ctx } from "./context.ts";

export function writeBackup(ctx: Ctx, destination: string): string {
  const dataDir = ctx.config.dataDir;
  if (!dataDir) throw new Error("an in-memory server has nothing to back up");
  const dir = resolve(destination);
  if (existsSync(dir) && readdirSync(dir).length > 0)
    throw new Error(`${dir} is not empty`);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const target = join(dir, "storage.db").replaceAll("'", "''");
  ctx.db.exec(`VACUUM INTO '${target}'`);
  for (const sub of ["blobs", "tls"]) {
    const src = join(dataDir, sub);
    if (existsSync(src))
      cpSync(src, join(dir, sub), {
        recursive: true,
        filter: (p) => !p.includes(`${sep}blobs${sep}tmp`),
      });
  }
  const cfg = join(dataDir, "config.json");
  if (existsSync(cfg)) cpSync(cfg, join(dir, "config.json"));
  ctx.audit.append({
    actor: null,
    action: "backup.create",
    detail: { head: ctx.audit.head().slice(0, 16) },
  });
  return dir;
}
