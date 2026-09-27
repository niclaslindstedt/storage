// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Routes for the `admin` account role (SPEC §6.7).

import type { Ctx } from "../context.ts";
import { forbidden } from "../errors.ts";
import type { Req, Router } from "../http/router.ts";
import {
  createAccount,
  deleteAccount,
  listAccounts,
  updateAccount,
  type Account,
} from "../services/accounts.ts";
import type { Principal } from "../services/principal.ts";
import { queryInt } from "./common.ts";

function admin(req: Req): Principal {
  const p = req.auth();
  if (p.role !== "admin") throw forbidden("admin only");
  return p;
}

export function adminRoutes(router: Router, ctx: Ctx): void {
  router.add("GET", "/v1/admin/accounts", (req) => {
    admin(req);
    return { json: { accounts: listAccounts(ctx) } };
  });
  router.add("POST", "/v1/admin/accounts", async (req) => {
    const p = admin(req);
    const b = await req.json();
    return {
      status: 201,
      json: createAccount(
        ctx,
        {
          name: String(b.name ?? ""),
          role: b.role as Account["role"],
          quotaBytes: b.quotaBytes as number | null | undefined,
        },
        p.deviceId,
      ),
    };
  });
  router.add("PATCH", "/v1/admin/accounts/:id", async (req) => {
    const p = admin(req);
    const b = await req.json();
    return {
      json: updateAccount(
        ctx,
        req.params.id!,
        {
          name: b.name as string | undefined,
          role: b.role as Account["role"] | undefined,
          quotaBytes: b.quotaBytes as number | null | undefined,
          disabled: b.disabled as boolean | undefined,
        },
        p.deviceId,
      ),
    };
  });
  router.add("DELETE", "/v1/admin/accounts/:id", async (req) => {
    const p = admin(req);
    await deleteAccount(ctx, req.params.id!, p.deviceId);
    return {};
  });
  router.add("GET", "/v1/admin/audit", (req) => {
    admin(req);
    return {
      json: {
        entries: ctx.audit.list(
          queryInt(req, "since") ?? 0,
          Math.min(queryInt(req, "limit") ?? 200, 1000),
        ),
        head: ctx.audit.head(),
      },
    };
  });
  router.add("GET", "/v1/admin/stats", (req) => {
    admin(req);
    const count = (sql: string) => ctx.db.get<{ n: number }>(sql)!.n;
    return {
      json: {
        accounts: count("SELECT COUNT(*) AS n FROM accounts"),
        devices: count(
          "SELECT COUNT(*) AS n FROM devices WHERE revoked_at IS NULL",
        ),
        namespaces: count("SELECT COUNT(*) AS n FROM namespaces"),
        files: count(
          "SELECT COUNT(*) AS n FROM files WHERE blob_hash IS NOT NULL",
        ),
        records: count(
          "SELECT COUNT(*) AS n FROM records WHERE value IS NOT NULL",
        ),
        blobBytes:
          ctx.db.get<{ n: number | null }>("SELECT SUM(size) AS n FROM blobs")!
            .n ?? 0,
        audit: ctx.audit.verify(),
      },
    };
  });
}
