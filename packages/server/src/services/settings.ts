// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Server settings an admin changes at runtime (SPEC §5, §11.1): how long
// earlier versions of files and trashed files are kept. The configuration
// (`retention.*`, flags, env, config.json) gives the defaults; a value set
// from the console, the CLI or an agent is stored in the database, wins
// over the configuration, and applies at once — to the next write of a
// file and to the next housekeeping run (hourly).

import type { Ctx } from "../context.ts";
import { getSetting, setSetting } from "../context.ts";
import { badRequest } from "../errors.ts";

export type Retention = {
  /** Keep every earlier version of a file for this many days after it was replaced (0 = none). */
  historyDays: number;
  /** …but never more than this many versions per file. */
  historyCount: number;
  /** Keep deleted files in the trash for this many days. */
  trashDays: number;
};

export type RetentionKey = keyof Retention;

/** Bounds for each setting, inclusive. */
export const RETENTION_LIMITS: Record<RetentionKey, [number, number]> = {
  historyDays: [0, 3650],
  historyCount: [1, 10_000],
  trashDays: [1, 3650],
};

const KEY = "retention";

function stored(ctx: Ctx): Partial<Retention> {
  const raw = getSetting(ctx, KEY);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Partial<Retention>;
  } catch {
    return {};
  }
}

/** The retention the server applies now: stored settings over the configuration. */
export function retention(ctx: Ctx): Retention & { tombstoneDays: number } {
  return { ...ctx.config.retention, ...stored(ctx) };
}

export type SettingsView = {
  retention: Retention;
  /** What the configuration says (used for any setting not changed here). */
  defaults: Retention;
  /** The settings changed at runtime (these win over the configuration). */
  changed: RetentionKey[];
  limits: typeof RETENTION_LIMITS;
};

export function getSettings(ctx: Ctx): SettingsView {
  const { historyDays, historyCount, trashDays } = retention(ctx);
  const c = ctx.config.retention;
  return {
    retention: { historyDays, historyCount, trashDays },
    defaults: {
      historyDays: c.historyDays,
      historyCount: c.historyCount,
      trashDays: c.trashDays,
    },
    changed: Object.keys(stored(ctx)) as RetentionKey[],
    limits: RETENTION_LIMITS,
  };
}

/**
 * Change settings. `null` for a key goes back to the configuration's value.
 * Unknown keys and out-of-range values are refused, nothing is half-applied.
 */
export function updateSettings(
  ctx: Ctx,
  patch: Record<string, unknown>,
  audit: { actor: string; ip?: string | null },
): SettingsView {
  if (!patch || typeof patch !== "object" || Array.isArray(patch))
    throw badRequest("settings must be an object");
  const next = stored(ctx);
  const detail: Record<string, number | null> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (!(key in RETENTION_LIMITS))
      throw badRequest(`unknown setting ${JSON.stringify(key)}`);
    const k = key as RetentionKey;
    if (value === null) {
      delete next[k];
      detail[k] = null;
      continue;
    }
    const [lo, hi] = RETENTION_LIMITS[k];
    if (
      typeof value !== "number" ||
      !Number.isInteger(value) ||
      value < lo ||
      value > hi
    )
      throw badRequest(`${k} must be a whole number from ${lo} to ${hi}`);
    next[k] = value;
    detail[k] = value;
  }
  if (Object.keys(detail).length === 0) throw badRequest("nothing to change");
  ctx.db.tx(() => {
    setSetting(ctx, KEY, JSON.stringify(next));
    ctx.audit.append({
      actor: audit.actor,
      action: "settings.update",
      ip: audit.ip ?? null,
      detail,
    });
  });
  ctx.log.info(`settings: ${JSON.stringify(detail)} by ${audit.actor}`);
  return getSettings(ctx);
}
