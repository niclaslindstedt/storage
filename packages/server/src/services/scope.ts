// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Agent scopes (SPEC §11.4). An agent device — an AI agent's MCP server,
// a script, anything that should not hold a whole account — is paired with
// a scope: the permissions it has and, optionally, the apps whose
// namespaces it may see. The server enforces the scope on every request, so
// a prompt-injected agent that rewrites its own configuration still cannot
// do more than the person at the machine granted. A scope is set when the
// pairing is minted and can only ever be narrowed afterwards.
//
// Unscoped devices (every ordinary app install) have no scope: `null` means
// everything their account and namespace roles allow.

import { badRequest, forbidden } from "../errors.ts";

export const PERMISSIONS = [
  "data:read",
  "data:write",
  "sharing",
  "devices",
  "console:read",
  "console:write",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export type AgentScope = {
  /** Sorted, normalized (a write permission implies its read). */
  perms: Permission[];
  /** App ids whose namespaces the device may see; null = every app. */
  apps: string[] | null;
};

/** What `--agent` grants when no permissions are named. */
export const DEFAULT_AGENT_PERMS: Permission[] = ["data:read"];

const APP_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/;

/** Add the permissions a permission implies, dedupe and sort. */
function normalize(perms: Iterable<Permission>): Permission[] {
  const set = new Set(perms);
  if (set.has("data:write") || set.has("sharing")) set.add("data:read");
  if (set.has("console:write")) set.add("console:read");
  return PERMISSIONS.filter((p) => set.has(p));
}

/**
 * Validate a scope from a request or the command line. Accepts
 * `{perms?: string[], apps?: string[] | null}`; `perms` defaults to
 * {@link DEFAULT_AGENT_PERMS}.
 */
export function parseScope(input: unknown, what = "agent"): AgentScope {
  if (input === true) input = {};
  if (typeof input !== "object" || input === null || Array.isArray(input))
    throw badRequest(`${what} must be an object {perms, apps}`);
  const o = input as Record<string, unknown>;
  for (const k of Object.keys(o))
    if (k !== "perms" && k !== "apps")
      throw badRequest(`${what}.${k} is not a scope field`);
  let perms: Permission[] = DEFAULT_AGENT_PERMS;
  if (o.perms !== undefined) {
    if (!Array.isArray(o.perms) || o.perms.length > PERMISSIONS.length * 2)
      throw badRequest(`${what}.perms must be an array`);
    perms = o.perms.map((p) => {
      if (!PERMISSIONS.includes(p as Permission))
        throw badRequest(
          `${what}.perms: unknown permission ${JSON.stringify(p)} (one of ${PERMISSIONS.join(", ")})`,
        );
      return p as Permission;
    });
  }
  let apps: string[] | null = null;
  if (o.apps !== undefined && o.apps !== null) {
    if (!Array.isArray(o.apps) || o.apps.length === 0 || o.apps.length > 32)
      throw badRequest(`${what}.apps must be 1-32 app ids, or null`);
    apps = [
      ...new Set(
        o.apps.map((a) => {
          if (typeof a !== "string" || !APP_PATTERN.test(a))
            throw badRequest(`${what}.apps: invalid app id`);
          return a;
        }),
      ),
    ].sort();
  }
  return { perms: normalize(perms), apps };
}

/** A stored scope (JSON column), or null for an unscoped device. */
export function readScope(json: string | null): AgentScope | null {
  if (json === null) return null;
  try {
    return parseScope(JSON.parse(json));
  } catch {
    // A corrupt scope must never widen into "unscoped": grant nothing.
    return { perms: [], apps: [] };
  }
}

export function writeScope(scope: AgentScope | null): string | null {
  return scope === null ? null : JSON.stringify(scope);
}

/** Whether `inner` grants nothing `outer` does not (null = unscoped). */
export function isWithin(inner: AgentScope, outer: AgentScope | null): boolean {
  if (outer === null) return true;
  if (!inner.perms.every((p) => outer.perms.includes(p))) return false;
  if (outer.apps === null) return true;
  return (
    inner.apps !== null && inner.apps.every((a) => outer.apps!.includes(a))
  );
}

/** The narrower of two scopes: what both grant. */
export function intersect(a: AgentScope, b: AgentScope | null): AgentScope {
  if (b === null) return a;
  const apps =
    a.apps === null
      ? b.apps
      : b.apps === null
        ? a.apps
        : a.apps.filter((x) => b.apps!.includes(x));
  return {
    perms: normalize(a.perms.filter((p) => b.perms.includes(p))),
    apps,
  };
}

export function has(scope: AgentScope | null, perm: Permission): boolean {
  return scope === null || scope.perms.includes(perm);
}

/** Whether a scoped device may see namespaces of `app`. */
export function appAllowed(scope: AgentScope | null, app: string): boolean {
  return scope === null || scope.apps === null || scope.apps.includes(app);
}

// ---- route table ---------------------------------------------------------------

/**
 * What each authenticated device-API route needs from a scoped device.
 * `always`: nothing beyond being signed in. A route missing here is refused
 * to every scoped device (fail closed); a test checks the table covers the
 * router, so a new route cannot silently become reachable.
 */
const ROUTES: Record<string, Permission | "always"> = {
  "GET /v1/info": "always",
  "POST /v1/auth/logout": "always",
  "GET /v1/me": "always",
  // Special-cased below: a device may always store its own account key copy.
  "PUT /v1/me/keys": "devices",
  "GET /v1/me/devices": "devices",
  "GET /v1/me/pending-devices": "devices",
  "PATCH /v1/devices/:id": "devices",
  "DELETE /v1/devices/:id": "devices",
  "POST /v1/pairings": "devices",
  "GET /v1/events": "data:read",

  "GET /v1/namespaces": "data:read",
  "POST /v1/namespaces": "data:write",
  "GET /v1/namespaces/:ns": "data:read",
  "PATCH /v1/namespaces/:ns": "data:write",
  "DELETE /v1/namespaces/:ns": "data:write",
  "GET /v1/namespaces/:ns/members": "data:read",
  "PATCH /v1/namespaces/:ns/members/:account": "sharing",
  "DELETE /v1/namespaces/:ns/members/:account": "sharing",
  "GET /v1/namespaces/:ns/invites": "sharing",
  "POST /v1/namespaces/:ns/invites": "sharing",
  "DELETE /v1/namespaces/:ns/invites/:id": "sharing",
  "POST /v1/invites/accept": "sharing",
  "POST /v1/namespaces/:ns/keys": "sharing",
  "POST /v1/namespaces/:ns/rotate": "sharing",

  "GET /v1/ns/:ns/files": "data:read",
  "HEAD /v1/ns/:ns/files/*path": "data:read",
  "GET /v1/ns/:ns/files/*path": "data:read",
  "PUT /v1/ns/:ns/files/*path": "data:write",
  "DELETE /v1/ns/:ns/files/*path": "data:write",
  "POST /v1/ns/:ns/files:move": "data:write",
  "POST /v1/ns/:ns/files:copy": "data:write",
  "GET /v1/ns/:ns/history/*path": "data:read",
  "GET /v1/ns/:ns/revisions/:fileId/:rev": "data:read",
  "POST /v1/ns/:ns/history:restore": "data:write",
  "GET /v1/ns/:ns/trash": "data:read",
  "POST /v1/ns/:ns/trash:restore": "data:write",
  "DELETE /v1/ns/:ns/trash/:fileId": "data:write",
  "POST /v1/ns/:ns/uploads": "data:write",
  "PUT /v1/ns/:ns/uploads/:id/parts/:n": "data:write",
  "POST /v1/ns/:ns/uploads/:id/commit": "data:write",
  "DELETE /v1/ns/:ns/uploads/:id": "data:write",

  "GET /v1/ns/:ns/collections": "data:read",
  "GET /v1/ns/:ns/records/:collection": "data:read",
  "GET /v1/ns/:ns/records/:collection/:key": "data:read",
  "PUT /v1/ns/:ns/records/:collection/:key": "data:write",
  "DELETE /v1/ns/:ns/records/:collection/:key": "data:write",
  "POST /v1/ns/:ns/batch": "data:write",
  "GET /v1/ns/:ns/changes": "data:read",

  "GET /v1/admin/accounts": "console:read",
  "POST /v1/admin/accounts": "console:write",
  "PATCH /v1/admin/accounts/:id": "console:write",
  "DELETE /v1/admin/accounts/:id": "console:write",
  "GET /v1/admin/audit": "console:read",
  "GET /v1/admin/stats": "console:read",

  "GET /v1/console/*rest": "console:read",
  "POST /v1/console/*rest": "console:write",
  "PATCH /v1/console/*rest": "console:write",
  "DELETE /v1/console/*rest": "console:write",
};

/** Console calls that use POST but change nothing. */
const READ_ONLY_CONSOLE_POSTS = new Set(["audit/verify"]);

/** The route keys the table knows (for the coverage test). */
export const SCOPED_ROUTES = Object.keys(ROUTES);

/** What a route needs from a scoped device, or null when it is unlisted. */
export function routePermission(
  method: string,
  pattern: string,
  params: Record<string, string>,
): Permission | "always" | null {
  if (
    method === "POST" &&
    pattern === "/v1/console/*rest" &&
    READ_ONLY_CONSOLE_POSTS.has(params.rest ?? "")
  )
    return "console:read";
  return ROUTES[`${method} ${pattern}`] ?? null;
}

/**
 * Refuse a request a scoped device may not make. Called by the HTTP
 * handler for every authenticated request, before the route runs, with the
 * matched route's own method (a HEAD served by a GET route is a GET).
 */
export function enforceRouteScope(
  principal: { scope: AgentScope | null; deviceId: string },
  method: string,
  pattern: string,
  params: Record<string, string>,
): void {
  const scope = principal.scope;
  if (scope === null) return;
  // Any device may sign itself out for good (`storage-mcp unpair`).
  if (
    method === "DELETE" &&
    pattern === "/v1/devices/:id" &&
    params.id === principal.deviceId
  )
    return;
  const need = routePermission(method, pattern, params);
  if (need === "always") return;
  if (need === null)
    throw forbidden("this agent device may not use this endpoint");
  // PUT /v1/me/keys is also how a device stores its own copy of the account
  // key after recovery or approval; the route checks that case itself.
  if (method === "PUT" && pattern === "/v1/me/keys") return;
  if (!scope.perms.includes(need))
    throw forbidden(`this agent device lacks the ${need} permission`);
}

/** Refuse a scoped device access to a namespace of an app it may not see. */
export function assertAppAllowed(scope: AgentScope | null, app: string): void {
  if (!appAllowed(scope, app))
    throw forbidden(`this agent device may not use ${app} namespaces`);
}
