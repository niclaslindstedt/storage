// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Namespaces: the unit of storage, sharing and encryption. Each has its own
// key (per epoch, wrapped to every member account), its own change sequence,
// and members with roles. Everything user-authored about a namespace — its
// name, icon, colour — is in the sealed `meta`.

import type { Ctx } from "../context.ts";
import { requireEpoch } from "../envelope.ts";
import {
  badRequest,
  conflict,
  forbidden,
  notFound,
  preconditionFailed,
} from "../errors.ts";
import { checkApp, checkB64u } from "../validate.ts";
import { newId } from "../util/random.ts";
import { checkWrap } from "./accounts.ts";
import type { Principal } from "./principal.ts";

export type NsRole = "owner" | "editor" | "viewer";
const RANK: Record<NsRole, number> = { viewer: 1, editor: 2, owner: 3 };

export type NamespaceRow = {
  id: string;
  app: string;
  owner_account_id: string;
  epoch: number;
  meta: string;
  meta_rev: number;
  members_rev: number;
  seq: number;
  purged_seq: number;
  used_bytes: number;
  created_at: number;
  deleted_at: number | null;
};

export type NamespaceView = {
  id: string;
  app: string;
  role: NsRole;
  ownerAccountId: string;
  epoch: number;
  meta: string;
  metaRev: string;
  seq: string;
  usedBytes: number;
  createdAt: number;
  /** This account's wrapped key per epoch. */
  keys: Record<string, string>;
};

export type Member = {
  accountId: string;
  name: string;
  role: NsRole;
  /** Has a key wrap for the current epoch. */
  hasKey: boolean;
  aekPublic: string | null;
};

export function getNamespaceRow(ctx: Ctx, id: string): NamespaceRow | null {
  return (
    ctx.db.get<NamespaceRow>(
      "SELECT * FROM namespaces WHERE id = ? AND deleted_at IS NULL",
      id,
    ) ?? null
  );
}

/**
 * Resolve a namespace for a principal with at least `min` role. Non-members
 * get 404 (not 403) so namespace ids cannot be probed.
 */
export function requireRole(
  ctx: Ctx,
  principal: Principal,
  nsId: string,
  min: NsRole,
): { ns: NamespaceRow; role: NsRole } {
  const ns = typeof nsId === "string" ? getNamespaceRow(ctx, nsId) : null;
  const member = ns
    ? ctx.db.get<{ role: NsRole }>(
        "SELECT role FROM members WHERE namespace_id = ? AND account_id = ?",
        nsId,
        principal.accountId,
      )
    : undefined;
  if (!ns || !member) throw notFound("no such namespace");
  if (RANK[member.role] < RANK[min]) {
    throw forbidden(`requires the ${min} role in this namespace`);
  }
  return { ns, role: member.role };
}

/** Increment and return the namespace sequence (inside a transaction). */
export function bumpSeq(ctx: Ctx, nsId: string): number {
  ctx.db.run("UPDATE namespaces SET seq = seq + 1 WHERE id = ?", nsId);
  return ctx.db.get<{ seq: number }>(
    "SELECT seq FROM namespaces WHERE id = ?",
    nsId,
  )!.seq;
}

export function memberIds(ctx: Ctx, nsId: string): string[] {
  return ctx.db
    .all<{ account_id: string }>(
      "SELECT account_id FROM members WHERE namespace_id = ?",
      nsId,
    )
    .map((r) => r.account_id);
}

/** Tell members' devices that a namespace moved (after the transaction). */
export function publish(ctx: Ctx, nsId: string): void {
  const row = ctx.db.get<{ seq: number }>(
    "SELECT seq FROM namespaces WHERE id = ?",
    nsId,
  );
  if (row) ctx.events.publishNs(nsId, row.seq, memberIds(ctx, nsId));
}

function view(
  ctx: Ctx,
  ns: NamespaceRow,
  accountId: string,
  role: NsRole,
): NamespaceView {
  const keys: Record<string, string> = {};
  for (const k of ctx.db.all<{ epoch: number; wrap: string }>(
    "SELECT epoch, wrap FROM key_wraps WHERE namespace_id = ? AND account_id = ? ORDER BY epoch",
    ns.id,
    accountId,
  )) {
    keys[String(k.epoch)] = k.wrap;
  }
  return {
    id: ns.id,
    app: ns.app,
    role,
    ownerAccountId: ns.owner_account_id,
    epoch: ns.epoch,
    meta: ns.meta,
    metaRev: String(ns.meta_rev),
    seq: String(ns.seq),
    usedBytes: ns.used_bytes,
    createdAt: ns.created_at,
    keys,
  };
}

function checkMeta(ctx: Ctx, meta: unknown, epoch: number): string {
  if (typeof meta !== "string") throw badRequest("meta is required");
  const bytes = checkB64u(meta, "meta");
  if (bytes.byteLength > ctx.config.limits.maxMetaBytes)
    throw badRequest("meta is too large");
  requireEpoch(bytes, epoch, "meta");
  return meta;
}

export function createNamespace(
  ctx: Ctx,
  principal: Principal,
  input: { id?: unknown; app: unknown; meta: unknown; wrap: unknown },
): NamespaceView {
  if (principal.role === "guest")
    throw forbidden("guests cannot create namespaces");
  // The client may choose the id: it salts the namespace key derivation and
  // is bound into every ciphertext, so the device must know it up front.
  if (
    input.id !== undefined &&
    (typeof input.id !== "string" || !/^ns_[A-Za-z0-9_-]{22}$/.test(input.id))
  ) {
    throw badRequest("id must be ns_ followed by 22 base64url characters");
  }
  const app = checkApp(String(input.app ?? ""));
  const meta = checkMeta(ctx, input.meta, 1);
  const wrap = checkWrap(input.wrap, "wrap");
  const id = (input.id as string | undefined) ?? newId("ns");
  if (ctx.db.get("SELECT 1 FROM namespaces WHERE id = ?", id))
    throw conflict("a namespace with that id exists");
  const now = ctx.clock.now();
  ctx.db.tx(() => {
    ctx.db.run(
      `INSERT INTO namespaces(id, app, owner_account_id, epoch, meta, meta_rev, members_rev, seq, created_at)
       VALUES (?, ?, ?, 1, ?, 1, 1, 1, ?)`,
      id,
      app,
      principal.accountId,
      meta,
      now,
    );
    ctx.db.run(
      "INSERT INTO members(namespace_id, account_id, role, created_at) VALUES (?, ?, 'owner', ?)",
      id,
      principal.accountId,
      now,
    );
    ctx.db.run(
      "INSERT INTO key_wraps(namespace_id, epoch, account_id, wrap) VALUES (?, 1, ?, ?)",
      id,
      principal.accountId,
      wrap,
    );
    ctx.audit.append({
      actor: principal.deviceId,
      action: "namespace.create",
      target: id,
      detail: { app },
    });
  });
  ctx.events.publishNamespaces([principal.accountId]);
  return getNamespace(ctx, principal, id);
}

export function getNamespace(
  ctx: Ctx,
  principal: Principal,
  nsId: string,
): NamespaceView {
  const { ns, role } = requireRole(ctx, principal, nsId, "viewer");
  return view(ctx, ns, principal.accountId, role);
}

export function listNamespaces(
  ctx: Ctx,
  principal: Principal,
  app?: string,
): NamespaceView[] {
  if (app !== undefined) checkApp(app);
  const rows = ctx.db.all<NamespaceRow & { role: NsRole }>(
    `SELECT n.*, m.role FROM namespaces n
     JOIN members m ON m.namespace_id = n.id AND m.account_id = ?
     WHERE n.deleted_at IS NULL ${app !== undefined ? "AND n.app = ?" : ""}
     ORDER BY n.created_at, n.id`,
    ...(app !== undefined ? [principal.accountId, app] : [principal.accountId]),
  );
  return rows.map((r) => view(ctx, r, principal.accountId, r.role));
}

export function updateNamespaceMeta(
  ctx: Ctx,
  principal: Principal,
  nsId: string,
  meta: unknown,
  ifRev?: string,
): NamespaceView {
  const { ns } = requireRole(ctx, principal, nsId, "editor");
  const checked = checkMeta(ctx, meta, ns.epoch);
  ctx.db.tx(() => {
    const current = getNamespaceRow(ctx, nsId)!;
    if (ifRev !== undefined && String(current.meta_rev) !== ifRev) {
      throw preconditionFailed({
        rev: String(current.meta_rev),
        meta: current.meta,
      });
    }
    const seq = bumpSeq(ctx, nsId);
    ctx.db.run(
      "UPDATE namespaces SET meta = ?, meta_rev = ? WHERE id = ?",
      checked,
      seq,
      nsId,
    );
  });
  publish(ctx, nsId);
  return getNamespace(ctx, principal, nsId);
}

export async function deleteNamespace(
  ctx: Ctx,
  principal: Principal | null,
  nsId: string,
): Promise<void> {
  if (principal) requireRole(ctx, principal, nsId, "owner");
  else if (!getNamespaceRow(ctx, nsId)) throw notFound("no such namespace");
  const members = memberIds(ctx, nsId);
  ctx.db.tx(() => {
    for (const r of ctx.db.all<{ blob_hash: string }>(
      "SELECT blob_hash FROM file_revisions WHERE namespace_id = ?",
      nsId,
    )) {
      ctx.blobs.unref(r.blob_hash);
    }
    for (const r of ctx.db.all<{ blob_hash: string }>(
      `SELECT p.blob_hash FROM upload_parts p JOIN uploads u ON u.id = p.upload_id
       WHERE u.namespace_id = ?`,
      nsId,
    )) {
      ctx.blobs.unref(r.blob_hash);
    }
    ctx.db.run("DELETE FROM namespaces WHERE id = ?", nsId);
    ctx.audit.append({
      actor: principal?.deviceId ?? "cli",
      action: "namespace.delete",
      target: nsId,
    });
  });
  await ctx.blobs.flush();
  ctx.events.publishNamespaces(members);
}

export function listMembers(
  ctx: Ctx,
  principal: Principal,
  nsId: string,
): Member[] {
  const { ns } = requireRole(ctx, principal, nsId, "viewer");
  return ctx.db
    .all<{
      account_id: string;
      name: string;
      role: NsRole;
      has_key: number;
      aek_public: string | null;
    }>(
      `SELECT m.account_id, a.name, m.role, a.aek_public,
              EXISTS(SELECT 1 FROM key_wraps k WHERE k.namespace_id = m.namespace_id
                     AND k.account_id = m.account_id AND k.epoch = ?) AS has_key
       FROM members m JOIN accounts a ON a.id = m.account_id
       WHERE m.namespace_id = ? ORDER BY m.created_at`,
      ns.epoch,
      nsId,
    )
    .map((r) => ({
      accountId: r.account_id,
      name: r.name,
      role: r.role,
      hasKey: Boolean(r.has_key),
      aekPublic: r.aek_public,
    }));
}

function assertAnotherOwner(
  ctx: Ctx,
  nsId: string,
  exceptAccountId: string,
): void {
  const n = ctx.db.get<{ n: number }>(
    "SELECT COUNT(*) AS n FROM members WHERE namespace_id = ? AND role = 'owner' AND account_id <> ?",
    nsId,
    exceptAccountId,
  )!.n;
  if (n === 0) throw conflict("a namespace must keep at least one owner");
}

function bumpMembers(ctx: Ctx, nsId: string): void {
  const seq = bumpSeq(ctx, nsId);
  ctx.db.run("UPDATE namespaces SET members_rev = ? WHERE id = ?", seq, nsId);
}

export function updateMemberRole(
  ctx: Ctx,
  principal: Principal,
  nsId: string,
  accountId: string,
  role: NsRole,
): void {
  requireRole(ctx, principal, nsId, "owner");
  if (!(role in RANK)) throw badRequest("role must be owner, editor or viewer");
  const member = ctx.db.get<{ role: NsRole }>(
    "SELECT role FROM members WHERE namespace_id = ? AND account_id = ?",
    nsId,
    accountId,
  );
  if (!member) throw notFound("no such member");
  ctx.db.tx(() => {
    if (member.role === "owner" && role !== "owner")
      assertAnotherOwner(ctx, nsId, accountId);
    ctx.db.run(
      "UPDATE members SET role = ? WHERE namespace_id = ? AND account_id = ?",
      role,
      nsId,
      accountId,
    );
    bumpMembers(ctx, nsId);
    ctx.audit.append({
      actor: principal.deviceId,
      action: "member.role",
      target: nsId,
      detail: { account: accountId, role },
    });
  });
  publish(ctx, nsId);
}

/** Remove a member (owners remove anyone; anyone may leave). */
export function removeMember(
  ctx: Ctx,
  principal: Principal,
  nsId: string,
  accountId: string,
): void {
  const self = accountId === principal.accountId;
  requireRole(ctx, principal, nsId, self ? "viewer" : "owner");
  const member = ctx.db.get<{ role: NsRole }>(
    "SELECT role FROM members WHERE namespace_id = ? AND account_id = ?",
    nsId,
    accountId,
  );
  if (!member) throw notFound("no such member");
  ctx.db.tx(() => {
    if (member.role === "owner") assertAnotherOwner(ctx, nsId, accountId);
    ctx.db.run(
      "DELETE FROM members WHERE namespace_id = ? AND account_id = ?",
      nsId,
      accountId,
    );
    ctx.db.run(
      "DELETE FROM key_wraps WHERE namespace_id = ? AND account_id = ?",
      nsId,
      accountId,
    );
    bumpMembers(ctx, nsId);
    ctx.audit.append({
      actor: principal.deviceId,
      action: self ? "member.leave" : "member.remove",
      target: nsId,
      detail: { account: accountId },
    });
  });
  publish(ctx, nsId);
  ctx.events.publishNamespaces([accountId]);
}

/**
 * Store key wraps for an epoch. A member may store their own; an owner may
 * store anyone's (e.g. re-wrapping for a member after rotation).
 */
export function addKeyWraps(
  ctx: Ctx,
  principal: Principal,
  nsId: string,
  input: { epoch: number; wraps: Record<string, string> },
): void {
  const { ns, role } = requireRole(ctx, principal, nsId, "viewer");
  if (
    !Number.isSafeInteger(input.epoch) ||
    input.epoch < 1 ||
    input.epoch > ns.epoch
  ) {
    throw badRequest("epoch must be an existing key epoch");
  }
  const members = new Set(memberIds(ctx, nsId));
  const entries = Object.entries(input.wraps ?? {});
  if (entries.length === 0) throw badRequest("wraps is empty");
  for (const [accountId, wrap] of entries) {
    if (!members.has(accountId))
      throw badRequest(`${accountId} is not a member`);
    if (accountId !== principal.accountId && role !== "owner") {
      throw forbidden("only owners store keys for other members");
    }
    checkWrap(wrap, `wraps.${accountId}`);
  }
  ctx.db.tx(() => {
    for (const [accountId, wrap] of entries) {
      ctx.db.run(
        `INSERT INTO key_wraps(namespace_id, epoch, account_id, wrap) VALUES (?, ?, ?, ?)
         ON CONFLICT(namespace_id, epoch, account_id) DO UPDATE SET wrap = excluded.wrap`,
        nsId,
        input.epoch,
        accountId,
        wrap,
      );
    }
  });
}

/**
 * Start a new key epoch. The owner supplies the new key wrapped to *every*
 * current member (so nobody silently loses access); from now on the server
 * refuses writes sealed under an older epoch. Re-encrypting existing data is
 * the client's job (SPEC §4.3).
 */
export function rotateNamespace(
  ctx: Ctx,
  principal: Principal,
  nsId: string,
  input: { epoch: number; wraps: Record<string, string> },
): NamespaceView {
  const { ns } = requireRole(ctx, principal, nsId, "owner");
  if (input.epoch !== ns.epoch + 1) {
    throw conflict("epoch must be the current epoch + 1", { epoch: ns.epoch });
  }
  const members = memberIds(ctx, nsId);
  const wraps = input.wraps ?? {};
  for (const m of members) {
    if (!(m in wraps)) throw badRequest(`missing key wrap for member ${m}`);
  }
  for (const [accountId, wrap] of Object.entries(wraps)) {
    if (!members.includes(accountId))
      throw badRequest(`${accountId} is not a member`);
    checkWrap(wrap, `wraps.${accountId}`);
  }
  ctx.db.tx(() => {
    for (const [accountId, wrap] of Object.entries(wraps)) {
      ctx.db.run(
        "INSERT INTO key_wraps(namespace_id, epoch, account_id, wrap) VALUES (?, ?, ?, ?)",
        nsId,
        input.epoch,
        accountId,
        wrap,
      );
    }
    const seq = bumpSeq(ctx, nsId);
    ctx.db.run(
      "UPDATE namespaces SET epoch = ?, meta_rev = ? WHERE id = ?",
      input.epoch,
      seq,
      nsId,
    );
    ctx.audit.append({
      actor: principal.deviceId,
      action: "namespace.rotate",
      target: nsId,
      detail: { epoch: input.epoch },
    });
  });
  publish(ctx, nsId);
  return getNamespace(ctx, principal, nsId);
}

/** Add a member (inside the caller's transaction); keeps a higher role. */
export function addMember(
  ctx: Ctx,
  nsId: string,
  accountId: string,
  role: NsRole,
): NsRole {
  const existing = ctx.db.get<{ role: NsRole }>(
    "SELECT role FROM members WHERE namespace_id = ? AND account_id = ?",
    nsId,
    accountId,
  );
  if (existing && RANK[existing.role] >= RANK[role]) return existing.role;
  ctx.db.run(
    `INSERT INTO members(namespace_id, account_id, role, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(namespace_id, account_id) DO UPDATE SET role = excluded.role`,
    nsId,
    accountId,
    role,
    ctx.clock.now(),
  );
  bumpMembers(ctx, nsId);
  return role;
}
