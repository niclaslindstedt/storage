// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Invites share ONE namespace with someone else (SPEC §6.3, §9). The owner's
// device derives `code = HKDF(X)` and seals the namespace keys under
// `HKDF(X)`; only the code reaches the server. Whoever holds X (the QR / link)
// joins with the invite's role and opens the keys; someone without an
// account on this server gets a restricted guest account — nobody shares
// their own account to share a namespace.

import type { Ctx } from "../context.ts";
import { badRequest, notFound } from "../errors.ts";
import { checkB64u } from "../validate.ts";
import { newId, sha256B64u } from "../util/random.ts";
import { checkAccountName, findAccountByName } from "./accounts.ts";
import { checkDeviceInput, insertDevice } from "./devices.ts";
import {
  addMember,
  getNamespaceRow,
  publish,
  requireRole,
} from "./namespaces.ts";
import {
  type Principal,
  type RequestMeta,
  SECRET_PATTERN,
} from "./principal.ts";
import { assertAppAllowed } from "./scope.ts";
import { conflict } from "../errors.ts";
import type { NsRole } from "./namespaces.ts";

export type Invite = {
  id: string;
  namespaceId: string;
  role: "editor" | "viewer";
  createdAt: number;
  expiresAt: number;
  maxUses: number;
  uses: number;
  revoked: boolean;
};

const MAX_PAYLOAD_BYTES = 64 * 1024;

export function createInvite(
  ctx: Ctx,
  principal: Principal,
  nsId: string,
  input: {
    role: unknown;
    code: unknown;
    payload: unknown;
    ttlSeconds?: number;
    maxUses?: number;
  },
): { inviteId: string; expiresAt: number } {
  requireRole(ctx, principal, nsId, "owner");
  if (input.role !== "editor" && input.role !== "viewer") {
    throw badRequest("role must be editor or viewer");
  }
  if (typeof input.code !== "string" || !SECRET_PATTERN.test(input.code)) {
    throw badRequest("code must be 32 bytes base64url");
  }
  if (typeof input.payload !== "string")
    throw badRequest("payload is required");
  if (checkB64u(input.payload, "payload").byteLength > MAX_PAYLOAD_BYTES) {
    throw badRequest("payload is too large");
  }
  const ttl = input.ttlSeconds ?? ctx.config.ttl.inviteSeconds;
  if (!Number.isSafeInteger(ttl) || ttl < 60 || ttl > 90 * 24 * 3600) {
    throw badRequest("ttlSeconds must be between 60 and 7776000");
  }
  const maxUses = input.maxUses ?? 1;
  if (!Number.isSafeInteger(maxUses) || maxUses < 1 || maxUses > 100) {
    throw badRequest("maxUses must be between 1 and 100");
  }
  const id = newId("inv");
  const now = ctx.clock.now();
  const expiresAt = now + ttl * 1000;
  try {
    ctx.db.run(
      `INSERT INTO invites(id, namespace_id, code_hash, role, payload, created_by, created_at, expires_at, max_uses)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      nsId,
      sha256B64u(input.code),
      input.role,
      input.payload,
      principal.accountId,
      now,
      expiresAt,
      maxUses,
    );
  } catch {
    throw conflict("invite code already in use");
  }
  ctx.audit.append({
    actor: principal.deviceId,
    action: "invite.create",
    target: nsId,
    detail: { invite: id, role: input.role, maxUses },
  });
  return { inviteId: id, expiresAt };
}

export function listInvites(
  ctx: Ctx,
  principal: Principal,
  nsId: string,
): Invite[] {
  requireRole(ctx, principal, nsId, "owner");
  return ctx.db
    .all<{
      id: string;
      namespace_id: string;
      role: "editor" | "viewer";
      created_at: number;
      expires_at: number;
      max_uses: number;
      uses: number;
      revoked_at: number | null;
    }>("SELECT * FROM invites WHERE namespace_id = ? ORDER BY created_at", nsId)
    .map((r) => ({
      id: r.id,
      namespaceId: r.namespace_id,
      role: r.role,
      createdAt: r.created_at,
      expiresAt: r.expires_at,
      maxUses: r.max_uses,
      uses: r.uses,
      revoked: r.revoked_at !== null,
    }));
}

export function revokeInvite(
  ctx: Ctx,
  principal: Principal,
  nsId: string,
  inviteId: string,
): void {
  requireRole(ctx, principal, nsId, "owner");
  const r = ctx.db.run(
    "UPDATE invites SET revoked_at = ? WHERE id = ? AND namespace_id = ? AND revoked_at IS NULL",
    ctx.clock.now(),
    inviteId,
    nsId,
  );
  if (r.changes === 0) throw notFound("no such invite");
  ctx.audit.append({
    actor: principal.deviceId,
    action: "invite.revoke",
    target: nsId,
    detail: { invite: inviteId },
  });
}

export async function acceptInvite(
  ctx: Ctx,
  principal: Principal | null,
  input: { code: unknown; device?: unknown; accountName?: unknown },
  meta: RequestMeta,
): Promise<{
  namespaceId: string;
  app: string;
  role: NsRole;
  payload: string;
  accountId: string;
  deviceId?: string;
}> {
  if (typeof input.code !== "string" || !SECRET_PATTERN.test(input.code)) {
    throw notFound("no such invite");
  }
  // Validate the new device outside the transaction (key import is async).
  const device = principal ? null : await checkDeviceInput(input.device);
  const name = principal ? null : checkAccountName(input.accountName);
  const out = ctx.db.tx(() => {
    const inv = ctx.db.get<{
      id: string;
      namespace_id: string;
      role: "editor" | "viewer";
      payload: string;
      expires_at: number;
      max_uses: number;
      uses: number;
      revoked_at: number | null;
    }>(
      "SELECT * FROM invites WHERE code_hash = ?",
      sha256B64u(input.code as string),
    );
    const now = ctx.clock.now();
    if (
      !inv ||
      inv.revoked_at !== null ||
      inv.expires_at < now ||
      inv.uses >= inv.max_uses
    ) {
      throw notFound("no such invite");
    }
    const ns = getNamespaceRow(ctx, inv.namespace_id);
    if (!ns) throw notFound("no such invite");
    // Checked before the invite is used up, so a refused agent wastes nothing.
    if (principal) assertAppAllowed(principal.scope, ns.app);
    let accountId = principal?.accountId;
    let deviceId: string | undefined;
    if (!accountId) {
      if (findAccountByName(ctx, name!))
        throw conflict("an account with that name exists");
      accountId = newId("acc");
      ctx.db.run(
        "INSERT INTO accounts(id, name, role, quota_bytes, created_at) VALUES (?, ?, 'guest', 0, ?)",
        accountId,
        name,
        now,
      );
      deviceId = insertDevice(ctx, accountId, device!, meta.origin);
      ctx.audit.append({
        actor: "invite",
        action: "account.create",
        target: accountId,
        detail: { role: "guest" },
      });
    }
    ctx.db.run("UPDATE invites SET uses = uses + 1 WHERE id = ?", inv.id);
    const role = addMember(ctx, inv.namespace_id, accountId, inv.role);
    ctx.audit.append({
      actor: deviceId ?? principal!.deviceId,
      action: "invite.accept",
      target: inv.namespace_id,
      ip: meta.ip,
      detail: { invite: inv.id, account: accountId, role },
    });
    return {
      namespaceId: inv.namespace_id,
      app: ns.app,
      role,
      payload: inv.payload,
      accountId,
      deviceId,
    };
  });
  publish(ctx, out.namespaceId);
  ctx.events.publishNamespaces([out.accountId]);
  return out;
}
