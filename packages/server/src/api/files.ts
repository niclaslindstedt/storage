// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Routes: files, history, trash and multi-part uploads (SPEC §6.4).

import type { Ctx } from "../context.ts";
import { badRequest } from "../errors.ts";
import type { Router } from "../http/router.ts";
import {
  copyFile,
  deleteFile,
  fileHistory,
  listFiles,
  listTrash,
  moveFile,
  purgeTrash,
  putFile,
  readFile,
  readRevision,
  restoreRevision,
  restoreTrash,
  statFile,
} from "../services/files.ts";
import {
  abortUpload,
  commitUpload,
  createUpload,
  putPart,
} from "../services/uploads.ts";
import {
  etag,
  header,
  ifMatch,
  ifNoneMatchAny,
  optString,
  queryBool,
  queryInt,
} from "./common.ts";

function fileHeaders(e: {
  rev: string;
  fileId: string;
  meta: string | null;
  size: number;
}) {
  return {
    ETag: etag(e.rev),
    "X-File-Id": e.fileId,
    "Content-Length": String(e.size),
    ...(e.meta ? { "X-Meta": e.meta } : {}),
  };
}

export function fileRoutes(router: Router, ctx: Ctx): void {
  router.add("GET", "/v1/ns/:ns/files", (req) => ({
    json: listFiles(ctx, req.auth(), req.params.ns!, {
      prefix: req.query.get("prefix") ?? undefined,
      recursive: queryBool(req, "recursive"),
      cursor: req.query.get("cursor") ?? undefined,
      limit: queryInt(req, "limit"),
    }),
  }));

  router.add("HEAD", "/v1/ns/:ns/files/*path", (req) => {
    const e = statFile(ctx, req.auth(), req.params.ns!, req.params.path!);
    return { status: 200, headers: fileHeaders(e) };
  });

  router.add("GET", "/v1/ns/:ns/files/*path", async (req) => {
    const { entry, stream } = await readFile(
      ctx,
      req.auth(),
      req.params.ns!,
      req.params.path!,
    );
    return { body: stream, headers: fileHeaders(entry) };
  });

  router.add("PUT", "/v1/ns/:ns/files/*path", async (req) => {
    const p = req.auth();
    const data = await req.bytes(ctx.config.limits.maxBodyBytes);
    const out = await putFile(ctx, p, req.params.ns!, req.params.path!, {
      data,
      meta: header(req, "x-meta"),
      ifMatch: ifMatch(req),
      ifNoneMatch: ifNoneMatchAny(req),
    });
    return {
      status: 200,
      json: out,
      headers: { ETag: etag(out.rev), "X-Seq": out.seq },
    };
  });

  router.add("DELETE", "/v1/ns/:ns/files/*path", async (req) => ({
    json: await deleteFile(ctx, req.auth(), req.params.ns!, req.params.path!, {
      ifMatch: ifMatch(req),
    }),
  }));

  router.add("POST", "/v1/ns/:ns/files:move", async (req) => {
    const b = await req.json();
    return {
      json: await moveFile(ctx, req.auth(), req.params.ns!, {
        from: String(b.from ?? ""),
        to: String(b.to ?? ""),
        meta: b.meta,
        ifMatch: optString(b, "ifMatch"),
        overwrite: b.overwrite === true,
      }),
    };
  });

  router.add("POST", "/v1/ns/:ns/files:copy", async (req) => {
    const b = await req.json();
    return {
      json: await copyFile(ctx, req.auth(), req.params.ns!, {
        from: String(b.from ?? ""),
        to: String(b.to ?? ""),
        meta: b.meta,
      }),
    };
  });

  router.add("GET", "/v1/ns/:ns/history/*path", (req) => ({
    json: {
      revisions: fileHistory(ctx, req.auth(), req.params.ns!, req.params.path!),
    },
  }));

  router.add("GET", "/v1/ns/:ns/revisions/:fileId/:rev", (req) => ({
    body: readRevision(
      ctx,
      req.auth(),
      req.params.ns!,
      req.params.fileId!,
      req.params.rev!,
    ),
  }));

  router.add("POST", "/v1/ns/:ns/history:restore", async (req) => {
    const b = await req.json();
    return {
      json: await restoreRevision(ctx, req.auth(), req.params.ns!, {
        path: String(b.path ?? ""),
        rev: String(b.rev ?? ""),
        meta: b.meta,
        ifMatch: optString(b, "ifMatch"),
      }),
    };
  });

  router.add("GET", "/v1/ns/:ns/trash", (req) => ({
    json: { entries: listTrash(ctx, req.auth(), req.params.ns!) },
  }));
  router.add("POST", "/v1/ns/:ns/trash:restore", async (req) => {
    const b = await req.json();
    return {
      json: await restoreTrash(ctx, req.auth(), req.params.ns!, {
        fileId: String(b.fileId ?? ""),
        path: optString(b, "path"),
        meta: b.meta,
      }),
    };
  });
  router.add("DELETE", "/v1/ns/:ns/trash/:fileId", async (req) => {
    await purgeTrash(ctx, req.auth(), req.params.ns!, req.params.fileId!);
    return {};
  });

  router.add("POST", "/v1/ns/:ns/uploads", (req) => ({
    status: 201,
    json: createUpload(ctx, req.auth(), req.params.ns!),
  }));
  router.add("PUT", "/v1/ns/:ns/uploads/:id/parts/:n", async (req) => {
    const p = req.auth();
    const n = Number(req.params.n);
    if (!/^\d{1,5}$/.test(req.params.n!))
      throw badRequest("part number must be an integer");
    const data = await req.bytes(ctx.config.limits.maxPartBytes);
    return {
      json: await putPart(ctx, p, req.params.ns!, req.params.id!, n, data),
    };
  });
  router.add("POST", "/v1/ns/:ns/uploads/:id/commit", async (req) => {
    const b = await req.json();
    const out = await commitUpload(
      ctx,
      req.auth(),
      req.params.ns!,
      req.params.id!,
      {
        path: String(b.path ?? ""),
        meta: b.meta,
        ifMatch: optString(b, "ifMatch"),
        ifNoneMatch: b.ifNoneMatch === true,
      },
    );
    return { json: out, headers: { ETag: etag(out.rev) } };
  });
  router.add("DELETE", "/v1/ns/:ns/uploads/:id", async (req) => {
    await abortUpload(ctx, req.auth(), req.params.ns!, req.params.id!);
    return {};
  });
}
