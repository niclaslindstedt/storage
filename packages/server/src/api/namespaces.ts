// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Routes: namespaces, members, invites, key wraps and rotation (SPEC §6.3).

import type { Ctx } from "../context.ts";
import { badRequest } from "../errors.ts";
import type { Router } from "../http/router.ts";
import {
  acceptInvite,
  createInvite,
  listInvites,
  revokeInvite,
} from "../services/invites.ts";
import {
  addKeyWraps,
  createNamespace,
  deleteNamespace,
  getNamespace,
  listMembers,
  listNamespaces,
  type NsRole,
  removeMember,
  rotateNamespace,
  updateMemberRole,
  updateNamespaceMeta,
} from "../services/namespaces.ts";
import { ifMatch, optString } from "./common.ts";

function wraps(body: Record<string, unknown>): Record<string, string> {
  const w = body.wraps;
  if (typeof w !== "object" || w === null || Array.isArray(w))
    throw badRequest("wraps must be an object");
  return w as Record<string, string>;
}

function epoch(body: Record<string, unknown>): number {
  const e = body.epoch;
  if (typeof e !== "number" || !Number.isSafeInteger(e))
    throw badRequest("epoch must be an integer");
  return e;
}

export function namespaceRoutes(router: Router, ctx: Ctx): void {
  router.add("GET", "/v1/namespaces", (req) => ({
    json: {
      namespaces: listNamespaces(
        ctx,
        req.auth(),
        req.query.get("app") ?? undefined,
      ),
    },
  }));
  router.add("POST", "/v1/namespaces", async (req) => {
    const body = await req.json();
    return {
      status: 201,
      json: createNamespace(ctx, req.auth(), body as never),
    };
  });
  router.add("GET", "/v1/namespaces/:ns", (req) => ({
    json: getNamespace(ctx, req.auth(), req.params.ns!),
  }));
  router.add("PATCH", "/v1/namespaces/:ns", async (req) => {
    const body = await req.json();
    return {
      json: updateNamespaceMeta(
        ctx,
        req.auth(),
        req.params.ns!,
        body.meta,
        ifMatch(req) ?? optString(body, "ifRev"),
      ),
    };
  });
  router.add("DELETE", "/v1/namespaces/:ns", async (req) => {
    await deleteNamespace(ctx, req.auth(), req.params.ns!);
    return {};
  });

  router.add("GET", "/v1/namespaces/:ns/members", (req) => ({
    json: { members: listMembers(ctx, req.auth(), req.params.ns!) },
  }));
  router.add("PATCH", "/v1/namespaces/:ns/members/:account", async (req) => {
    const body = await req.json();
    updateMemberRole(
      ctx,
      req.auth(),
      req.params.ns!,
      req.params.account!,
      body.role as NsRole,
    );
    return {};
  });
  router.add("DELETE", "/v1/namespaces/:ns/members/:account", (req) => {
    removeMember(ctx, req.auth(), req.params.ns!, req.params.account!);
    return {};
  });

  router.add("GET", "/v1/namespaces/:ns/invites", (req) => ({
    json: { invites: listInvites(ctx, req.auth(), req.params.ns!) },
  }));
  router.add("POST", "/v1/namespaces/:ns/invites", async (req) => {
    const body = await req.json();
    return {
      status: 201,
      json: createInvite(ctx, req.auth(), req.params.ns!, {
        role: body.role,
        code: body.code,
        payload: body.payload,
        ttlSeconds:
          typeof body.ttlSeconds === "number" ? body.ttlSeconds : undefined,
        maxUses: typeof body.maxUses === "number" ? body.maxUses : undefined,
      }),
    };
  });
  router.add("DELETE", "/v1/namespaces/:ns/invites/:id", (req) => {
    revokeInvite(ctx, req.auth(), req.params.ns!, req.params.id!);
    return {};
  });

  router.add(
    "POST",
    "/v1/invites/accept",
    async (req) => {
      const body = await req.json();
      const out = await acceptInvite(
        ctx,
        req.principal,
        { code: body.code, device: body.device, accountName: body.accountName },
        { ip: req.ip, origin: req.origin },
      );
      return { json: { ...out, serverId: ctx.serverId } };
    },
    { auth: "optional", rate: "public" },
  );

  router.add("POST", "/v1/namespaces/:ns/keys", async (req) => {
    const body = await req.json();
    addKeyWraps(ctx, req.auth(), req.params.ns!, {
      epoch: epoch(body),
      wraps: wraps(body),
    });
    return {};
  });
  router.add("POST", "/v1/namespaces/:ns/rotate", async (req) => {
    const body = await req.json();
    return {
      json: rotateNamespace(ctx, req.auth(), req.params.ns!, {
        epoch: epoch(body),
        wraps: wraps(body),
      }),
    };
  });
}
