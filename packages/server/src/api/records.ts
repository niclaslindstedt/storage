// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Routes: records, batches and the change feed (SPEC §6.5, §6.6).

import type { Ctx } from "../context.ts";
import type { Router } from "../http/router.ts";
import { changes } from "../services/changes.ts";
import {
  batch,
  deleteRecord,
  getRecord,
  listCollections,
  listRecords,
  putRecord,
} from "../services/records.ts";
import {
  etag,
  ifMatch,
  ifNoneMatchAny,
  optString,
  queryBool,
  queryInt,
} from "./common.ts";

export function recordRoutes(router: Router, ctx: Ctx): void {
  router.add("GET", "/v1/ns/:ns/collections", (req) => ({
    json: { collections: listCollections(ctx, req.auth(), req.params.ns!) },
  }));

  router.add("GET", "/v1/ns/:ns/records/:collection", (req) => ({
    json: listRecords(ctx, req.auth(), req.params.ns!, req.params.collection!, {
      cursor: req.query.get("cursor") ?? undefined,
      limit: queryInt(req, "limit"),
      includeDeleted: queryBool(req, "includeDeleted"),
    }),
  }));

  router.add("GET", "/v1/ns/:ns/records/:collection/:key", (req) => {
    const r = getRecord(
      ctx,
      req.auth(),
      req.params.ns!,
      req.params.collection!,
      req.params.key!,
    );
    return { json: r, headers: { ETag: etag(r.rev) } };
  });

  router.add("PUT", "/v1/ns/:ns/records/:collection/:key", async (req) => {
    const p = req.auth();
    const b = await req.json();
    const out = putRecord(
      ctx,
      p,
      req.params.ns!,
      req.params.collection!,
      req.params.key!,
      {
        value: b.value,
        ifRev: ifMatch(req) ?? optString(b, "ifRev"),
        ifAbsent: ifNoneMatchAny(req) || b.ifAbsent === true,
      },
    );
    return { json: out, headers: { ETag: etag(out.rev) } };
  });

  router.add("DELETE", "/v1/ns/:ns/records/:collection/:key", (req) => ({
    json: deleteRecord(
      ctx,
      req.auth(),
      req.params.ns!,
      req.params.collection!,
      req.params.key!,
      {
        ifRev: ifMatch(req),
      },
    ),
  }));

  router.add("POST", "/v1/ns/:ns/batch", async (req) => {
    const b = await req.json();
    return {
      json: await batch(ctx, req.auth(), req.params.ns!, {
        atomic: b.atomic !== false,
        ops: b.ops,
      }),
    };
  });

  router.add("GET", "/v1/ns/:ns/changes", async (req) => ({
    json: await changes(ctx, req.auth(), req.params.ns!, {
      since: req.query.get("since") ?? "0",
      limit: queryInt(req, "limit"),
      waitMs: (queryInt(req, "wait") ?? 0) * 1000,
      signal: req.signal,
    }),
  }));
}
