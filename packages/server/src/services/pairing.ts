// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Pairing (SPEC §9): a one-time code enrols a device. The code is either
// minted here (the console / CLI / admin page QR) or derived on an existing
// device from a secret the server never sees (`code = HKDF(X)`), in which
// case the pairing also carries the account key sealed under `HKDF(X)` —
// the new device opens it with the X it scanned. Codes are 256-bit, stored
// hashed, single-use and short-lived.

import type { Ctx } from "../context.ts";
import {
  badRequest,
  conflict,
  forbidden,
  notFound,
  unauthenticated,
} from "../errors.ts";
import { newId, newSecret, sha256B64u } from "../util/random.ts";
import {
  type Account,
  checkAccountName,
  checkWrap,
  findAccountByName,
  getAccount,
  getAccountRow,
} from "./accounts.ts";
import { type DeviceInput, checkDeviceInput, insertDevice } from "./devices.ts";
import {
  type AccountRole,
  type Principal,
  type RequestMeta,
  SECRET_PATTERN,
} from "./principal.ts";
import { type AgentScope, intersect, readScope, writeScope } from "./scope.ts";

export type PairingInput = {
  accountId?: string;
  newAccount?: { name: string; role: AccountRole };
  ttlSeconds?: number;
  /** A client-derived code (`HKDF(X)`); minted here when absent. */
  code?: string;
  /** The account key sealed under `HKDF(X)` (device-created pairings). */
  transfer?: string;
  /**
   * Enrol an admin device (SPEC §11.2): one that may use the admin console
   * remotely. Only the local console and the CLI may ask for it — never the
   * device API — and only for an admin account.
   */
  console?: boolean;
  /**
   * Enrol an agent device (SPEC §11.4): the device gets this scope and the
   * server holds it to it on every request. Console permissions need
   * `console`.
   */
  scope?: AgentScope;
};

export type PairingCreated = {
  pairingId: string;
  code?: string;
  expiresAt: number;
};

export function createPairing(
  ctx: Ctx,
  input: PairingInput,
  actor: string | null,
): PairingCreated {
  if ((input.accountId === undefined) === (input.newAccount === undefined)) {
    throw badRequest("exactly one of accountId or newAccount is required");
  }
  if (input.accountId !== undefined && !getAccountRow(ctx, input.accountId)) {
    throw notFound("no such account");
  }
  if (input.newAccount) {
    checkAccountName(input.newAccount.name);
    if (!["admin", "member", "guest"].includes(input.newAccount.role)) {
      throw badRequest("newAccount.role is invalid");
    }
    if (findAccountByName(ctx, input.newAccount.name)) {
      throw conflict("an account with that name exists");
    }
  }
  if (input.console) {
    const role =
      input.newAccount?.role ??
      getAccountRow(ctx, input.accountId!)?.role ??
      null;
    if (role !== "admin")
      throw badRequest("only an admin account can pair an admin device");
    if (input.code !== undefined || input.transfer !== undefined)
      throw badRequest("an admin device pairing is minted by the server");
  }
  if (
    input.scope &&
    !input.console &&
    input.scope.perms.some((p) => p.startsWith("console:"))
  )
    throw badRequest(
      "console permissions need an admin device pairing (console: true)",
    );
  if (input.code !== undefined && !SECRET_PATTERN.test(input.code)) {
    throw badRequest("code must be 32 bytes base64url");
  }
  if (input.transfer !== undefined) checkWrap(input.transfer, "transfer");
  const ttl = input.ttlSeconds ?? ctx.config.ttl.pairingSeconds;
  if (!Number.isSafeInteger(ttl) || ttl < 30 || ttl > 7 * 24 * 3600) {
    throw badRequest("ttlSeconds must be between 30 and 604800");
  }
  const minted = input.code === undefined ? newSecret() : undefined;
  const code = input.code ?? minted!;
  const id = newId("pair");
  const now = ctx.clock.now();
  const expiresAt = now + ttl * 1000;
  try {
    ctx.db.run(
      `INSERT INTO pairings(id, code_hash, account_id, new_account_name, new_account_role,
                            transfer, created_by, created_at, expires_at, console, scope)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      sha256B64u(code),
      input.accountId ?? null,
      input.newAccount?.name ?? null,
      input.newAccount?.role ?? null,
      input.transfer ?? null,
      actor,
      now,
      expiresAt,
      input.console ? 1 : 0,
      writeScope(input.scope ?? null),
    );
  } catch {
    throw conflict("pairing code already in use");
  }
  ctx.audit.append({
    actor,
    action: "pairing.create",
    target: id,
    detail: {
      account: input.accountId ?? null,
      newAccount: input.newAccount?.role ?? null,
      ...(input.console ? { console: true } : {}),
      ...(input.scope ? { agent: input.scope } : {}),
    },
  });
  return { pairingId: id, ...(minted ? { code: minted } : {}), expiresAt };
}

/**
 * A device may mint pairings for its own account; admins for anyone. An
 * agent device (with the devices permission) only for its own account, and
 * the device it enrols is never wider than itself: the pairing inherits the
 * agent's scope, narrowed by any scope asked for.
 */
export function authorizePairing(
  principal: Principal,
  input: PairingInput,
): void {
  // Remote admin access is granted by someone at the machine, never by a
  // device — not even an admin device (a stolen phone must not mint more).
  if (input.console)
    throw forbidden("admin devices are paired from the local console or CLI");
  if (principal.scope) {
    if (input.newAccount || input.accountId !== principal.accountId)
      throw forbidden("an agent device pairs devices to its own account only");
    input.scope = input.scope
      ? intersect(input.scope, principal.scope)
      : principal.scope;
  }
  if (principal.role === "admin") return;
  if (principal.role === "guest") throw forbidden("guests cannot add devices");
  if (input.newAccount || input.accountId !== principal.accountId) {
    throw forbidden("members can only pair devices to their own account");
  }
}

export async function redeemPairing(
  ctx: Ctx,
  input: { code: string; device: unknown },
  meta: RequestMeta,
): Promise<{
  deviceId: string;
  accountId: string;
  account: Account;
  transfer: string | null;
  /** Whether the device was enrolled as an admin device. */
  console: boolean;
  /** The agent scope the device was enrolled with (null: unscoped). */
  scope: AgentScope | null;
}> {
  if (typeof input.code !== "string" || !SECRET_PATTERN.test(input.code)) {
    throw unauthenticated("invalid pairing code");
  }
  const device: DeviceInput = await checkDeviceInput(input.device);
  const result = ctx.db.tx(() => {
    const row = ctx.db.get<{
      id: string;
      account_id: string | null;
      new_account_name: string | null;
      new_account_role: AccountRole | null;
      transfer: string | null;
      expires_at: number;
      used_at: number | null;
      console: number;
      scope: string | null;
    }>("SELECT * FROM pairings WHERE code_hash = ?", sha256B64u(input.code));
    if (!row || row.used_at !== null || row.expires_at < ctx.clock.now()) {
      throw unauthenticated("invalid or expired pairing code");
    }
    ctx.db.run(
      "UPDATE pairings SET used_at = ? WHERE id = ?",
      ctx.clock.now(),
      row.id,
    );
    let accountId = row.account_id;
    if (accountId === null) {
      if (findAccountByName(ctx, row.new_account_name!)) {
        throw conflict("an account with that name exists");
      }
      accountId = newId("acc");
      ctx.db.run(
        "INSERT INTO accounts(id, name, role, quota_bytes, created_at) VALUES (?, ?, ?, ?, ?)",
        accountId,
        row.new_account_name,
        row.new_account_role,
        row.new_account_role === "admin" ? null : ctx.config.defaultQuotaBytes,
        ctx.clock.now(),
      );
      ctx.audit.append({
        actor: "pairing",
        action: "account.create",
        target: accountId,
        detail: { role: row.new_account_role },
      });
    }
    const acc = getAccountRow(ctx, accountId);
    if (!acc || acc.disabled_at !== null)
      throw unauthenticated("account is disabled");
    const console = row.console === 1 && acc.role === "admin";
    const scope = readScope(row.scope);
    const deviceId = insertDevice(ctx, accountId, device, meta.origin, {
      console,
      scope,
    });
    ctx.audit.append({
      actor: deviceId,
      action: "device.pair",
      target: accountId,
      ip: meta.ip,
      detail: {
        pairing: row.id,
        platform: device.platform,
        ...(console ? { console: true } : {}),
        ...(scope ? { agent: scope } : {}),
      },
    });
    return { deviceId, accountId, transfer: row.transfer, console, scope };
  });
  return { ...result, account: getAccount(ctx, result.accountId)! };
}

/** Delete pairings that expired or were used more than a day ago. */
export function prunePairings(ctx: Ctx): void {
  const now = ctx.clock.now();
  ctx.db.run(
    "DELETE FROM pairings WHERE expires_at < ? OR (used_at IS NOT NULL AND used_at < ?)",
    now - 24 * 3600_000,
    now - 24 * 3600_000,
  );
}
