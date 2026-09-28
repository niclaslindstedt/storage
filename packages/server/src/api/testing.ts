// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Test-mode controls (SPEC §6.8): reset, snapshot / restore, fault
// injection, clock control and account seeding. Only mounted when the server
// runs with `testMode`, and every call must carry the per-run test secret.

import type { Ctx } from "../context.ts";
import { badRequest, forbidden } from "../errors.ts";
import type { FaultRule } from "../http/handler.ts";
import type { Req, Router } from "../http/router.ts";
import { pairingUri } from "../payload.ts";
import { createAccount } from "../services/accounts.ts";
import { createPairing } from "../services/pairing.ts";
import { runRetention } from "../services/retention.ts";
import { MIGRATIONS } from "../db/schema.ts";
import { constantTimeEqual } from "../util/random.ts";
import { fromB64u, toB64u } from "../util/b64.ts";
import type { OffsetClock } from "../util/clock.ts";

export type Snapshot = {
  tables: Record<string, Record<string, unknown>[]>;
  blobs: Record<string, string>;
};

const TABLES = [
  "settings",
  "accounts",
  "devices",
  "challenges",
  "tokens",
  "pairings",
  "namespaces",
  "members",
  "key_wraps",
  "invites",
  "blobs",
  "files",
  "file_revisions",
  "trash",
  "records",
  "uploads",
  "upload_parts",
  "audit",
  "origins",
] as const;

void MIGRATIONS;

export async function takeSnapshot(ctx: Ctx): Promise<Snapshot> {
  const tables: Snapshot["tables"] = {};
  for (const t of TABLES) {
    tables[t] = ctx.db
      .all<Record<string, unknown>>(`SELECT * FROM ${t}`)
      .map((row) =>
        Object.fromEntries(
          Object.entries(row).map(([k, v]) => [
            k,
            v instanceof Uint8Array ? { b64u: toB64u(v) } : v,
          ]),
        ),
      );
  }
  const blobs: Record<string, string> = {};
  for await (const hash of ctx.blobs.store.list()) {
    const bytes = await ctx.blobs.store.read(hash);
    if (bytes) blobs[hash] = toB64u(bytes);
  }
  return { tables, blobs };
}

export async function restoreSnapshot(ctx: Ctx, snap: Snapshot): Promise<void> {
  ctx.db.exec("PRAGMA foreign_keys = OFF");
  try {
    ctx.db.tx(() => {
      for (const t of [...TABLES].reverse()) ctx.db.run(`DELETE FROM ${t}`);
      for (const t of TABLES) {
        for (const row of snap.tables[t] ?? []) {
          const keys = Object.keys(row);
          if (keys.length === 0) continue;
          const values = keys.map((k) => {
            const v = row[k];
            if (v && typeof v === "object" && "b64u" in (v as object))
              return fromB64u((v as { b64u: string }).b64u);
            return v as never;
          });
          ctx.db.run(
            `INSERT INTO ${t}(${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`,
            ...values,
          );
        }
      }
    });
  } finally {
    ctx.db.exec("PRAGMA foreign_keys = ON");
  }
  for await (const hash of ctx.blobs.store.list()) {
    if (!(hash in snap.blobs)) await ctx.blobs.store.remove(hash);
  }
  for (const [, b64] of Object.entries(snap.blobs))
    await ctx.blobs.store.write(fromB64u(b64));
}

export type TestControls = {
  secret: string;
  faults: FaultRule[];
  clock: OffsetClock | null;
  baseUrl: () => string;
};

export function testRoutes(
  router: Router,
  ctx: Ctx,
  controls: TestControls,
): void {
  const guard = (req: Req) => {
    const s = req.headers["x-test-secret"];
    if (typeof s !== "string" || !constantTimeEqual(s, controls.secret))
      throw forbidden("bad test secret");
  };
  const opts = { auth: "none" as const, rate: "none" as const };
  let empty: Snapshot | null = null;

  router.add(
    "POST",
    "/__test/reset",
    async (req) => {
      guard(req);
      empty ??= {
        tables: { settings: [{ key: "server_id", value: ctx.serverId }] },
        blobs: {},
      };
      await restoreSnapshot(ctx, empty);
      controls.faults.splice(0);
      if (controls.clock) controls.clock.offsetMs = 0;
      return {};
    },
    opts,
  );

  router.add(
    "GET",
    "/__test/snapshot",
    async (req) => {
      guard(req);
      return { json: await takeSnapshot(ctx) };
    },
    opts,
  );

  router.add(
    "POST",
    "/__test/restore",
    async (req) => {
      guard(req);
      const body = await req.json();
      if (typeof body.tables !== "object" || typeof body.blobs !== "object")
        throw badRequest("not a snapshot");
      await restoreSnapshot(ctx, body as Snapshot);
      return {};
    },
    opts,
  );

  router.add(
    "POST",
    "/__test/faults",
    async (req) => {
      guard(req);
      const body = await req.json();
      if (!Array.isArray(body.rules))
        throw badRequest("rules must be an array");
      for (const r of body.rules as FaultRule[]) {
        if (!["offline", "status", "delay"].includes(r.action))
          throw badRequest("unknown fault action");
        controls.faults.push({ ...r, match: r.match ?? {} });
      }
      return { json: { faults: controls.faults.length } };
    },
    opts,
  );

  router.add(
    "DELETE",
    "/__test/faults",
    (req) => {
      guard(req);
      controls.faults.splice(0);
      return {};
    },
    opts,
  );

  router.add(
    "POST",
    "/__test/clock",
    async (req) => {
      guard(req);
      if (!controls.clock)
        throw badRequest("this server's clock is not adjustable");
      const body = await req.json();
      if (typeof body.advanceMs === "number")
        controls.clock.offsetMs += body.advanceMs;
      if (typeof body.set === "number")
        controls.clock.offsetMs = body.set - Date.now();
      if (body.reset === true) controls.clock.offsetMs = 0;
      return { json: { now: ctx.clock.now() } };
    },
    opts,
  );

  router.add(
    "POST",
    "/__test/retention",
    async (req) => {
      guard(req);
      return { json: await runRetention(ctx) };
    },
    opts,
  );

  router.add(
    "POST",
    "/__test/accounts",
    async (req) => {
      guard(req);
      const body = await req.json();
      const account = createAccount(
        ctx,
        {
          name: String(body.name ?? ""),
          role: (body.role as "admin" | "member" | "guest") ?? "member",
          quotaBytes: body.quotaBytes as number | null | undefined,
        },
        "test",
      );
      return {
        status: 201,
        json: { account, ...pairingFor(ctx, controls, account.id) },
      };
    },
    opts,
  );

  router.add(
    "POST",
    "/__test/accounts/:id/pairings",
    async (req) => {
      guard(req);
      const body = await req.json();
      return {
        status: 201,
        json: pairingFor(ctx, controls, req.params.id!, body.console === true),
      };
    },
    opts,
  );
}

function pairingFor(
  ctx: Ctx,
  controls: TestControls,
  accountId: string,
  console = false,
) {
  const { code, expiresAt } = createPairing(
    ctx,
    { accountId, console },
    "test",
  );
  return {
    pairingCode: code!,
    expiresAt,
    pairingUri: pairingUri({
      server: controls.baseUrl(),
      code: code!,
      name: ctx.config.name,
    }),
  };
}
