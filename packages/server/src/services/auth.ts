// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Device authentication (SPEC §6.1). There are no passwords: a device proves
// possession of its non-extractable signing key by signing a single-use
// server challenge, and receives a short-lived bearer token. Tokens are
// stored as SHA-256 hashes, so a database leak yields no usable token.

import type { Ctx } from "../context.ts";
import { unauthenticated } from "../errors.ts";
import { authMessage, verifySignature } from "../crypto.ts";
import { newSecret, sha256B64u } from "../util/random.ts";
import type { AccountRole, Principal } from "./principal.ts";

type LiveDevice = { id: string; account_id: string; dsk_public: string };

function liveDevice(ctx: Ctx, deviceId: string): LiveDevice | null {
  return (
    ctx.db.get<LiveDevice>(
      `SELECT d.id, d.account_id, d.dsk_public FROM devices d
       JOIN accounts a ON a.id = d.account_id
       WHERE d.id = ? AND d.revoked_at IS NULL AND a.disabled_at IS NULL`,
      deviceId,
    ) ?? null
  );
}

export function createChallenge(ctx: Ctx, deviceId: string): { challenge: string; expiresAt: number } {
  if (typeof deviceId !== "string" || !liveDevice(ctx, deviceId)) {
    throw unauthenticated("unknown or revoked device");
  }
  const challenge = newSecret();
  const expiresAt = ctx.clock.now() + ctx.config.ttl.challengeSeconds * 1000;
  ctx.db.run("DELETE FROM challenges WHERE expires_at < ?", ctx.clock.now());
  ctx.db.run(
    "INSERT INTO challenges(challenge, device_id, expires_at) VALUES (?, ?, ?)",
    challenge,
    deviceId,
    expiresAt,
  );
  return { challenge, expiresAt };
}

export async function issueToken(
  ctx: Ctx,
  input: { deviceId: string; challenge: string; signature: string },
  ip: string | null,
): Promise<{ token: string; expiresAt: number; accountId: string }> {
  const device = liveDevice(ctx, input.deviceId);
  // Consume the challenge whatever happens next: one attempt per challenge.
  const row = ctx.db.get<{ device_id: string; expires_at: number }>(
    "SELECT device_id, expires_at FROM challenges WHERE challenge = ?",
    input.challenge,
  );
  ctx.db.run("DELETE FROM challenges WHERE challenge = ?", input.challenge);
  if (!device || !row || row.device_id !== device.id || row.expires_at < ctx.clock.now()) {
    throw unauthenticated("invalid challenge");
  }
  const ok = await verifySignature(
    device.dsk_public,
    input.signature,
    authMessage(ctx.serverId, device.id, input.challenge),
  );
  if (!ok) {
    ctx.audit.append({ actor: device.id, action: "auth.fail", ip });
    throw unauthenticated("invalid signature");
  }
  const token = newSecret();
  const now = ctx.clock.now();
  const expiresAt = now + ctx.config.ttl.tokenSeconds * 1000;
  ctx.db.run("DELETE FROM tokens WHERE expires_at < ?", now);
  ctx.db.run(
    "INSERT INTO tokens(hash, device_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
    sha256B64u(token),
    device.id,
    now,
    expiresAt,
  );
  ctx.db.run("UPDATE devices SET last_seen_at = ? WHERE id = ?", now, device.id);
  return { token, expiresAt, accountId: device.account_id };
}

export function authenticate(ctx: Ctx, token: string): Principal | null {
  if (typeof token !== "string" || token.length < 20 || token.length > 100) return null;
  const row = ctx.db.get<{
    device_id: string;
    account_id: string;
    role: AccountRole;
    name: string;
    expires_at: number;
  }>(
    `SELECT t.device_id, d.account_id, a.role, a.name, t.expires_at FROM tokens t
     JOIN devices d ON d.id = t.device_id
     JOIN accounts a ON a.id = d.account_id
     WHERE t.hash = ? AND d.revoked_at IS NULL AND a.disabled_at IS NULL`,
    sha256B64u(token),
  );
  if (!row || row.expires_at <= ctx.clock.now()) return null;
  return {
    accountId: row.account_id,
    accountName: row.name,
    deviceId: row.device_id,
    role: row.role,
  };
}

export function revokeToken(ctx: Ctx, token: string): void {
  ctx.db.run("DELETE FROM tokens WHERE hash = ?", sha256B64u(token));
}
