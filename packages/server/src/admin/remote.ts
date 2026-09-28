// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The remote console (SPEC §11.2): the admin console's own API, reached
// through the device API at `/v1/console/*` by an admin device — a device
// of an admin account that was paired with a console pairing minted at the
// machine (local console or CLI). Same handlers as the local listener, so
// the remote app can do exactly what the console does; authentication is
// the device's signed-challenge token instead of the admin token, and every
// change is audited under the device's id.

import { ApiError, forbidden } from "../errors.ts";
import type { Req, Res, Router } from "../http/router.ts";
import type { ApiResult, ConsoleApi } from "./api.ts";

export const REMOTE_CONSOLE_PREFIX = "/v1/console";

const METHODS = ["GET", "POST", "PATCH", "DELETE"] as const;

/**
 * The console API path a remote path maps to: `/v1/console/x` → `/api/x`
 * for every x (so `/v1/console/metrics` is the Traffic page's JSON), and
 * `/v1/console/prometheus` → the Prometheus text at `/metrics`.
 */
export function consolePath(rest: string): string {
  return rest === "prometheus" ? "/metrics" : `/api/${rest}`;
}

function toRes(out: ApiResult, method: string): Res {
  if (out.sse) {
    const start = out.sse;
    return {
      sse(writer, onClose) {
        onClose(start((event, data) => writer.send(event, data)));
        const ping = setInterval(() => writer.comment("ping"), 25_000);
        onClose(() => clearInterval(ping));
      },
    };
  }
  if (out.stream)
    return {
      status: out.status ?? 200,
      headers: {
        "Content-Type": out.type ?? "application/octet-stream",
        ...out.headers,
      },
      body: out.stream,
    };
  if (out.text !== undefined)
    return {
      status: out.status ?? 200,
      headers: {
        "Content-Type": out.type ?? "text/plain; charset=utf-8",
        ...out.headers,
      },
      body: new TextEncoder().encode(out.text),
    };
  return {
    status: out.status ?? 200,
    headers: out.headers,
    json: out.json ?? (method === "GET" ? null : {}),
  };
}

export function remoteConsoleRoutes(router: Router, api: ConsoleApi): void {
  const { state, routes } = api;
  const { ctx } = state.deps;

  const handler = async (req: Req): Promise<Res> => {
    const p = req.auth();
    if (!ctx.config.remoteConsole)
      throw new ApiError(
        404,
        "not_found",
        "the remote console is off (--remote-console off)",
      );
    if (p.role !== "admin" || !p.console)
      throw forbidden(
        "only an admin device may use the console: pair one from the local console or with `storage-server pair --account <admin> --console`",
      );
    const matched = routes.match(req.method, consolePath(req.params.rest!));
    if (!matched)
      throw new ApiError(404, "not_found", "no such console endpoint");
    if ("methods" in matched)
      throw new ApiError(405, "method_not_allowed", "method not allowed");
    const mutating = req.method !== "GET";
    const out = await matched.handler({
      params: matched.params,
      query: req.query,
      ip: req.ip ?? "unknown",
      actor: p.deviceId,
      remote: true,
      async body() {
        return req.json();
      },
    });
    // A change can alter a check's verdict (e.g. the first admin account).
    if (mutating && (out.status ?? 200) < 400) void state.refreshChecks?.();
    return toRes(out, req.method);
  };

  for (const method of METHODS)
    router.add(method, `${REMOTE_CONSOLE_PREFIX}/*rest`, handler);
}
