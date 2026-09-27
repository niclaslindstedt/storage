// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Accounts: the people on a household server, their roles and quotas, and
// the account encryption key bundle (AEK public key + wrapped private key,
// SPEC §4.3) the server stores but cannot open.

import type { Ctx } from "../context.ts";
import { badRequest, conflict, notFound, quotaExceeded } from "../errors.ts";
import { checkB64u } from "../validate.ts";
import { importP256Public } from "../crypto.ts";
import { newId } from "../util/random.ts";
import { type AccountRole, NAME_PATTERN, type Principal } from "./principal.ts";

export type Account = {
  id: string;
  name: string;
  role: AccountRole;
  quotaBytes: number | null;
  usedBytes: number;
  createdAt: number;
  disabled: boolean;
  hasKeys: boolean;
};

type AccountRow = {
  id: string;
  name: string;
  role: AccountRole;
  quota_bytes: number | null;
  aek_public: string | null;
  recovery_wrap: string | null;
  created_at: number;
  disabled_at: number | null;
};

const ROLES: readonly AccountRole[] = ["admin", "member", "guest"];
const MAX_WRAP_BYTES = 4096;

function toAccount(ctx: Ctx, row: AccountRow): Account {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    quotaBytes: row.quota_bytes,
    usedBytes: accountUsage(ctx, row.id),
    createdAt: row.created_at,
    disabled: row.disabled_at !== null,
    hasKeys: row.aek_public !== null,
  };
}

export function getAccountRow(ctx: Ctx, id: string): AccountRow | null {
  return ctx.db.get<AccountRow>("SELECT * FROM accounts WHERE id = ?", id) ?? null;
}

export function getAccount(ctx: Ctx, id: string): Account | null {
  const row = getAccountRow(ctx, id);
  return row ? toAccount(ctx, row) : null;
}

export function findAccountByName(ctx: Ctx, name: string): Account | null {
  const row = ctx.db.get<AccountRow>("SELECT * FROM accounts WHERE name = ?", name);
  return row ? toAccount(ctx, row) : null;
}

export function listAccounts(ctx: Ctx): Account[] {
  return ctx.db
    .all<AccountRow>("SELECT * FROM accounts ORDER BY created_at, name")
    .map((r) => toAccount(ctx, r));
}

export function checkAccountName(name: unknown): string {
  if (typeof name !== "string" || !NAME_PATTERN.test(name) || name.trim() !== name) {
    throw badRequest("name must be 1-64 printable characters without surrounding spaces");
  }
  return name;
}

function checkRole(role: unknown): AccountRole {
  if (!ROLES.includes(role as AccountRole)) {
    throw badRequest(`role must be one of ${ROLES.join(", ")}`);
  }
  return role as AccountRole;
}

function checkQuota(q: unknown): number | null {
  if (q === null) return null;
  if (typeof q !== "number" || !Number.isSafeInteger(q) || q < 0) {
    throw badRequest("quotaBytes must be a non-negative integer or null");
  }
  return q;
}

export function createAccount(
  ctx: Ctx,
  input: { name: string; role: AccountRole; quotaBytes?: number | null },
  actor: string | null = null,
): Account {
  const name = checkAccountName(input.name);
  const role = checkRole(input.role);
  const quota =
    input.quotaBytes === undefined
      ? role === "admin"
        ? null
        : ctx.config.defaultQuotaBytes
      : checkQuota(input.quotaBytes);
  if (findAccountByName(ctx, name)) throw conflict("an account with that name exists");
  const id = newId("acc");
  ctx.db.run(
    "INSERT INTO accounts(id, name, role, quota_bytes, created_at) VALUES (?, ?, ?, ?, ?)",
    id,
    name,
    role,
    quota,
    ctx.clock.now(),
  );
  ctx.audit.append({ actor, action: "account.create", target: id, detail: { role } });
  return getAccount(ctx, id)!;
}

export function updateAccount(
  ctx: Ctx,
  id: string,
  patch: { name?: string; role?: AccountRole; quotaBytes?: number | null; disabled?: boolean },
  actor: string | null,
): Account {
  const row = getAccountRow(ctx, id);
  if (!row) throw notFound("no such account");
  ctx.db.tx(() => {
    if (patch.name !== undefined) {
      const name = checkAccountName(patch.name);
      const other = findAccountByName(ctx, name);
      if (other && other.id !== id) throw conflict("an account with that name exists");
      ctx.db.run("UPDATE accounts SET name = ? WHERE id = ?", name, id);
    }
    if (patch.role !== undefined) {
      const role = checkRole(patch.role);
      if (row.role === "admin" && role !== "admin") assertAnotherAdmin(ctx, id);
      ctx.db.run("UPDATE accounts SET role = ? WHERE id = ?", role, id);
    }
    if (patch.quotaBytes !== undefined) {
      ctx.db.run("UPDATE accounts SET quota_bytes = ? WHERE id = ?", checkQuota(patch.quotaBytes), id);
    }
    if (patch.disabled !== undefined) {
      if (patch.disabled && row.role === "admin") assertAnotherAdmin(ctx, id);
      ctx.db.run(
        "UPDATE accounts SET disabled_at = ? WHERE id = ?",
        patch.disabled ? ctx.clock.now() : null,
        id,
      );
      if (patch.disabled) {
        ctx.db.run(
          "DELETE FROM tokens WHERE device_id IN (SELECT id FROM devices WHERE account_id = ?)",
          id,
        );
      }
    }
    ctx.audit.append({
      actor,
      action: "account.update",
      target: id,
      detail: Object.fromEntries(Object.entries(patch).filter(([k]) => k !== "name")),
    });
  });
  return getAccount(ctx, id)!;
}

function assertAnotherAdmin(ctx: Ctx, exceptId: string): void {
  const n = ctx.db.get<{ n: number }>(
    "SELECT COUNT(*) AS n FROM accounts WHERE role = 'admin' AND disabled_at IS NULL AND id <> ?",
    exceptId,
  )!.n;
  if (n === 0) throw conflict("the server must keep at least one active admin");
}

/** Bytes held by every namespace the account owns. */
export function accountUsage(ctx: Ctx, accountId: string): number {
  return (
    ctx.db.get<{ n: number | null }>(
      "SELECT SUM(used_bytes) AS n FROM namespaces WHERE owner_account_id = ?",
      accountId,
    )?.n ?? 0
  );
}

/** Throw 507 if storing `extraBytes` more would exceed the owner's quota. */
export function assertQuota(ctx: Ctx, ownerAccountId: string, extraBytes: number): void {
  if (extraBytes <= 0) return;
  const row = getAccountRow(ctx, ownerAccountId);
  if (!row || row.quota_bytes === null) return;
  const used = accountUsage(ctx, ownerAccountId);
  if (used + extraBytes > row.quota_bytes) throw quotaExceeded(used, row.quota_bytes);
}

export function getAccountKeys(
  ctx: Ctx,
  accountId: string,
  deviceId: string,
): { aekPublic: string | null; recoveryWrap: string | null; deviceWrap: string | null } {
  const acc = getAccountRow(ctx, accountId);
  const dev = ctx.db.get<{ device_wrap: string | null }>(
    "SELECT device_wrap FROM devices WHERE id = ? AND account_id = ?",
    deviceId,
    accountId,
  );
  return {
    aekPublic: acc?.aek_public ?? null,
    recoveryWrap: acc?.recovery_wrap ?? null,
    deviceWrap: dev?.device_wrap ?? null,
  };
}

/**
 * Store the account key bundle. The AEK public key can be set once (a new
 * key would orphan every namespace wrapped to the old one). The recovery wrap
 * may be replaced (a regenerated recovery key). Device wraps may only target
 * this account's live devices.
 */
export async function setAccountKeys(
  ctx: Ctx,
  principal: Principal,
  input: { aekPublic?: string; recoveryWrap?: string; deviceWraps?: Record<string, string> },
): Promise<void> {
  const acc = getAccountRow(ctx, principal.accountId);
  if (!acc) throw notFound("no such account");
  if (input.aekPublic !== undefined) {
    await importP256Public(input.aekPublic, "ecdh", "aekPublic");
    if (acc.aek_public !== null && acc.aek_public !== input.aekPublic) {
      throw conflict("the account key is already set", { reason: "aek_set" });
    }
  }
  if (input.recoveryWrap !== undefined) checkWrap(input.recoveryWrap, "recoveryWrap");
  const wraps = Object.entries(input.deviceWraps ?? {});
  for (const [deviceId, wrap] of wraps) {
    checkWrap(wrap, `deviceWraps.${deviceId}`);
    const dev = ctx.db.get(
      "SELECT 1 FROM devices WHERE id = ? AND account_id = ? AND revoked_at IS NULL",
      deviceId,
      principal.accountId,
    );
    if (!dev) throw badRequest(`deviceWraps: unknown device ${deviceId}`);
  }
  if (acc.aek_public === null && input.aekPublic === undefined && wraps.length > 0) {
    throw badRequest("set aekPublic before wrapping it to devices");
  }
  ctx.db.tx(() => {
    if (input.aekPublic !== undefined && acc.aek_public === null) {
      ctx.db.run("UPDATE accounts SET aek_public = ? WHERE id = ?", input.aekPublic, acc.id);
    }
    if (input.recoveryWrap !== undefined) {
      ctx.db.run("UPDATE accounts SET recovery_wrap = ? WHERE id = ?", input.recoveryWrap, acc.id);
    }
    for (const [deviceId, wrap] of wraps) {
      ctx.db.run("UPDATE devices SET device_wrap = ? WHERE id = ?", wrap, deviceId);
    }
    ctx.audit.append({
      actor: principal.deviceId,
      action: "account.keys",
      target: acc.id,
      detail: {
        aek: input.aekPublic !== undefined,
        recovery: input.recoveryWrap !== undefined,
        devices: wraps.map(([d]) => d),
      },
    });
  });
}

export function checkWrap(wrap: unknown, what: string): string {
  if (typeof wrap !== "string" || wrap.length === 0) throw badRequest(`${what} is required`);
  const bytes = checkB64u(wrap, what);
  if (bytes.byteLength > MAX_WRAP_BYTES) throw badRequest(`${what} is too large`);
  return wrap;
}
