// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Helpers the data tools share: resolving a namespace under the local
// policy, listing namespaces of any app, argument schemas.

import type {
  StorageNamespace,
  StorageNamespaceInfo,
} from "@niclaslindstedt/oss-framework/storage/selfhosted";

import { s, type Schema } from "../protocol/schema.ts";
import { cleanName } from "../text.ts";
import { type Deps, ToolError } from "./registry.ts";

export const NS_ID = "^ns_[A-Za-z0-9_-]{22}$";

export const arg = {
  namespace: s.string(
    "The namespace (shared folder) id, ns_… — from list_namespaces.",
    { pattern: NS_ID, maxLength: 25 },
  ),
  path: s.string(
    'A path inside the namespace, "/"-separated, e.g. "reports/2026/june.md".',
    { minLength: 1, maxLength: 1024 },
  ),
  app: s.string('An app id, e.g. "drive", "notes", "meds".', {
    pattern: "^[a-z0-9][a-z0-9-]{0,31}$",
    maxLength: 32,
  }),
  id: (what: string): Schema =>
    s.string(what, {
      pattern: "^[a-z]{2,6}_[A-Za-z0-9_-]{8,64}$",
      maxLength: 72,
    }),
  limit: (max: number): Schema =>
    s.integer(
      `At most this many entries (default and maximum ${max}).`,
      1,
      max,
    ),
};

/** Refuse what the local policy excludes (apps / folders). */
export function allowedByPolicy(
  deps: Deps,
  ns: { id: string; app: string },
): boolean {
  const { apps, folders } = deps.config;
  if (apps && !apps.includes(ns.app)) return false;
  if (folders && !folders.includes(ns.id)) return false;
  return true;
}

export async function openNamespace(
  deps: Deps,
  id: string,
): Promise<StorageNamespace> {
  let ns: StorageNamespace;
  try {
    ns = await deps.client.namespace(id);
  } catch (err) {
    if ((err as Error).name === "NotFoundError")
      throw new ToolError(`no namespace ${id} (or this agent may not see it)`);
    throw err;
  }
  if (!allowedByPolicy(deps, ns))
    throw new ToolError(`no namespace ${id} (or this agent may not see it)`);
  return ns;
}

type RawNamespace = Parameters<Deps["client"]["decryptMeta"]>[0];

/** Namespaces of one app, or of every app the agent may see. */
export async function listNamespaces(
  deps: Deps,
  app?: string,
): Promise<StorageNamespaceInfo[]> {
  const { namespaces } = await deps.client.transport.json<{
    namespaces: (RawNamespace & { usedBytes: number })[];
  }>("GET", "/v1/namespaces", { query: { app } });
  const out: StorageNamespaceInfo[] = [];
  for (const raw of namespaces) {
    if (!allowedByPolicy(deps, raw)) continue;
    deps.client.observeSeq(raw.id, Number(raw.seq));
    let meta: StorageNamespaceInfo["meta"];
    try {
      meta = await deps.client.decryptMeta(raw);
    } catch {
      meta = { name: "(cannot decrypt)" };
    }
    out.push({
      id: raw.id,
      app: raw.app,
      role: raw.role,
      epoch: raw.epoch,
      seq: Number(raw.seq),
      ownerAccountId: raw.ownerAccountId,
      usedBytes: raw.usedBytes,
      keys: raw.keys,
      meta,
    });
  }
  return out;
}

/** "a/b" — no empty, "." or ".." segments, no control characters. */
export function checkPath(path: string): string {
  const segs = path.split("/");
  for (const seg of segs) {
    if (seg === "" || seg === "." || seg === "..")
      throw new ToolError(
        `invalid path ${JSON.stringify(path)}: empty, "." or ".." segment`,
      );
    if (seg !== cleanName(seg, 1000) || seg !== seg.trim())
      throw new ToolError(
        `invalid path ${JSON.stringify(path)}: control, invisible or surrounding space characters`,
      );
  }
  return path;
}

/** The marker file that keeps an empty folder (Storage Remote's convention). */
export const FOLDER_MARKER = ".folder";

export function isMarker(path: string): boolean {
  return path === FOLDER_MARKER || path.endsWith(`/${FOLDER_MARKER}`);
}

export const iso = (ms: number | null | undefined) =>
  typeof ms === "number" && ms > 0 ? new Date(ms).toISOString() : null;
