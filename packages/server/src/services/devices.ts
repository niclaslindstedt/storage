// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Devices: each app install is a device with its own P-256 key pairs. A
// device authenticates with its signing key; it receives the account key
// wrapped to its key-agreement key. Revoking a device kills its tokens, its
// wrapped account key and its event streams at once.

import type { Ctx } from "../context.ts";
import { badRequest, forbidden, notFound } from "../errors.ts";
import { importP256Public, safetyCode } from "../crypto.ts";
import { newId } from "../util/random.ts";
import { NAME_PATTERN, PLATFORM_PATTERN, type Principal } from "./principal.ts";

export type DeviceInput = {
  name: string;
  platform: string;
  dskPublic: string;
  dekPublic: string;
};

export type Device = {
  id: string;
  accountId: string;
  name: string;
  platform: string;
  dskPublic: string;
  dekPublic: string;
  hasAccountKey: boolean;
  createdAt: number;
  lastSeenAt: number | null;
  revokedAt: number | null;
};

type DeviceRow = {
  id: string;
  account_id: string;
  name: string;
  platform: string;
  dsk_public: string;
  dek_public: string;
  device_wrap: string | null;
  created_at: number;
  last_seen_at: number | null;
  revoked_at: number | null;
};

function toDevice(r: DeviceRow): Device {
  return {
    id: r.id,
    accountId: r.account_id,
    name: r.name,
    platform: r.platform,
    dskPublic: r.dsk_public,
    dekPublic: r.dek_public,
    hasAccountKey: r.device_wrap !== null,
    createdAt: r.created_at,
    lastSeenAt: r.last_seen_at,
    revokedAt: r.revoked_at,
  };
}

/** Validate a device's self-description and public keys. */
export async function checkDeviceInput(input: unknown): Promise<DeviceInput> {
  if (typeof input !== "object" || input === null)
    throw badRequest("device is required");
  const d = input as Record<string, unknown>;
  if (typeof d.name !== "string" || !NAME_PATTERN.test(d.name)) {
    throw badRequest("device.name must be 1-64 printable characters");
  }
  if (typeof d.platform !== "string" || !PLATFORM_PATTERN.test(d.platform)) {
    throw badRequest("device.platform must match [a-z0-9-]{1,32}");
  }
  if (typeof d.dskPublic !== "string" || typeof d.dekPublic !== "string") {
    throw badRequest("device keys are required");
  }
  await importP256Public(d.dskPublic, "ecdsa", "device.dskPublic");
  await importP256Public(d.dekPublic, "ecdh", "device.dekPublic");
  if (d.dskPublic === d.dekPublic) throw badRequest("device keys must differ");
  return {
    name: d.name,
    platform: d.platform,
    dskPublic: d.dskPublic,
    dekPublic: d.dekPublic,
  };
}

/** Insert a device (inside the caller's transaction). */
export function insertDevice(
  ctx: Ctx,
  accountId: string,
  input: DeviceInput,
  origin: string | null,
): string {
  const id = newId("dev");
  ctx.db.run(
    `INSERT INTO devices(id, account_id, name, platform, dsk_public, dek_public, origin, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    accountId,
    input.name,
    input.platform,
    input.dskPublic,
    input.dekPublic,
    origin,
    ctx.clock.now(),
  );
  if (origin) learnOrigin(ctx, origin);
  return id;
}

const ORIGIN = /^https?:\/\/[A-Za-z0-9.-]+(:\d{1,5})?$/;

/** Remember an app origin a device paired from (CORS mode `paired`). */
export function learnOrigin(ctx: Ctx, origin: string): void {
  if (!ORIGIN.test(origin)) return;
  ctx.db.run(
    "INSERT INTO origins(origin, created_at) VALUES (?, ?) ON CONFLICT(origin) DO NOTHING",
    origin,
    ctx.clock.now(),
  );
}

export function getDeviceRow(ctx: Ctx, id: string): DeviceRow | null {
  return (
    ctx.db.get<DeviceRow>("SELECT * FROM devices WHERE id = ?", id) ?? null
  );
}

export function listDevices(ctx: Ctx, accountId: string): Device[] {
  return ctx.db
    .all<DeviceRow>(
      "SELECT * FROM devices WHERE account_id = ? ORDER BY created_at",
      accountId,
    )
    .map(toDevice);
}

export function getDevice(ctx: Ctx, id: string): Device | null {
  const r = getDeviceRow(ctx, id);
  return r ? toDevice(r) : null;
}

/** Live devices still waiting for the account key, with their safety codes. */
export function pendingDevices(
  ctx: Ctx,
  accountId: string,
): (Device & { safetyCode: string })[] {
  return listDevices(ctx, accountId)
    .filter((d) => !d.hasAccountKey && d.revokedAt === null)
    .map((d) => ({ ...d, safetyCode: safetyCode(d.dskPublic, d.dekPublic) }));
}

function ownedOrAdmin(
  ctx: Ctx,
  principal: Principal,
  deviceId: string,
): DeviceRow {
  const row = getDeviceRow(ctx, deviceId);
  if (!row) throw notFound("no such device");
  if (row.account_id !== principal.accountId && principal.role !== "admin") {
    throw notFound("no such device");
  }
  return row;
}

export function renameDevice(
  ctx: Ctx,
  principal: Principal,
  deviceId: string,
  name: string,
): Device {
  const row = ownedOrAdmin(ctx, principal, deviceId);
  if (row.account_id !== principal.accountId)
    throw forbidden("rename your own devices only");
  if (!NAME_PATTERN.test(name))
    throw badRequest("name must be 1-64 printable characters");
  ctx.db.run("UPDATE devices SET name = ? WHERE id = ?", name, deviceId);
  return getDevice(ctx, deviceId)!;
}

export function revokeDevice(
  ctx: Ctx,
  principal: Principal | null,
  deviceId: string,
  ip: string | null,
  actor = "cli",
): void {
  const row = principal
    ? ownedOrAdmin(ctx, principal, deviceId)
    : getDeviceRow(ctx, deviceId);
  if (!row) throw notFound("no such device");
  ctx.db.tx(() => {
    ctx.db.run(
      "UPDATE devices SET revoked_at = COALESCE(revoked_at, ?), device_wrap = NULL WHERE id = ?",
      ctx.clock.now(),
      deviceId,
    );
    ctx.db.run("DELETE FROM tokens WHERE device_id = ?", deviceId);
    ctx.db.run("DELETE FROM challenges WHERE device_id = ?", deviceId);
    ctx.audit.append({
      actor: principal?.deviceId ?? actor,
      action: "device.revoke",
      target: deviceId,
      ip,
      detail: { account: row.account_id },
    });
  });
  ctx.events.revokeDevice(deviceId);
}
