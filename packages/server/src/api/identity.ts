// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Routes: server info, authentication, pairing, the signed-in account, its
// devices, and the live event stream (SPEC §6.1, §6.2, §6.6).

import type { Ctx } from "../context.ts";
import { badRequest } from "../errors.ts";
import type { Router } from "../http/router.ts";
import {
  getAccount,
  getAccountKeys,
  setAccountKeys,
} from "../services/accounts.ts";
import { createChallenge, issueToken, revokeToken } from "../services/auth.ts";
import {
  listDevices,
  pendingDevices,
  renameDevice,
  revokeDevice,
} from "../services/devices.ts";
import {
  authorizePairing,
  createPairing,
  redeemPairing,
} from "../services/pairing.ts";
import { optString } from "./common.ts";

export const PROTOCOL_VERSION = 1;
export const CAPABILITIES = [
  "files",
  "records",
  "batch",
  "changes",
  "events",
  "history",
  "trash",
  "uploads",
  "sharing",
  "rotation",
] as const;

export type ServerInfoExtras = () => {
  tls: { mode: string; fp?: string };
  version: string;
};

export function identityRoutes(
  router: Router,
  ctx: Ctx,
  extras: ServerInfoExtras,
): void {
  router.add(
    "GET",
    "/v1/info",
    () => ({
      json: {
        serverId: ctx.serverId,
        name: ctx.config.name,
        protocol: PROTOCOL_VERSION,
        capabilities: CAPABILITIES,
        time: ctx.clock.now(),
        ...extras(),
      },
    }),
    { auth: "optional", rate: "none" },
  );

  router.add(
    "POST",
    "/v1/auth/challenge",
    async (req) => {
      const body = await req.json();
      return { json: createChallenge(ctx, String(body.deviceId ?? "")) };
    },
    { auth: "none" },
  );

  router.add(
    "POST",
    "/v1/auth/token",
    async (req) => {
      const body = await req.json();
      const out = await issueToken(
        ctx,
        {
          deviceId: String(body.deviceId ?? ""),
          challenge: String(body.challenge ?? ""),
          signature: String(body.signature ?? ""),
        },
        req.ip,
      );
      return { json: out };
    },
    { auth: "none" },
  );

  router.add("POST", "/v1/auth/logout", (req) => {
    if (req.token) revokeToken(ctx, req.token);
    return {};
  });

  router.add(
    "POST",
    "/v1/pair",
    async (req) => {
      const body = await req.json();
      const out = await redeemPairing(
        ctx,
        { code: String(body.code ?? ""), device: body.device },
        { ip: req.ip, origin: req.origin },
      );
      return { status: 201, json: { ...out, serverId: ctx.serverId } };
    },
    { auth: "none" },
  );

  router.add("POST", "/v1/pairings", async (req) => {
    const p = req.auth();
    const body = await req.json();
    const input = {
      accountId:
        optString(body, "accountId") ??
        (body.newAccount ? undefined : p.accountId),
      newAccount: body.newAccount as
        { name: string; role: "admin" | "member" | "guest" } | undefined,
      ttlSeconds:
        typeof body.ttlSeconds === "number" ? body.ttlSeconds : undefined,
      code: optString(body, "code"),
      transfer: optString(body, "transfer"),
    };
    authorizePairing(p, input);
    return { status: 201, json: createPairing(ctx, input, p.deviceId) };
  });

  router.add("GET", "/v1/me", (req) => {
    const p = req.auth();
    return {
      json: {
        account: getAccount(ctx, p.accountId),
        deviceId: p.deviceId,
        keys: getAccountKeys(ctx, p.accountId, p.deviceId),
      },
    };
  });

  router.add("PUT", "/v1/me/keys", async (req) => {
    const p = req.auth();
    const body = await req.json();
    const deviceWraps = body.deviceWraps;
    if (
      deviceWraps !== undefined &&
      (typeof deviceWraps !== "object" || deviceWraps === null)
    ) {
      throw badRequest("deviceWraps must be an object");
    }
    await setAccountKeys(ctx, p, {
      aekPublic: optString(body, "aekPublic"),
      recoveryWrap: optString(body, "recoveryWrap"),
      deviceWraps: deviceWraps as Record<string, string> | undefined,
    });
    return { json: getAccountKeys(ctx, p.accountId, p.deviceId) };
  });

  router.add("GET", "/v1/me/devices", (req) => ({
    json: { devices: listDevices(ctx, req.auth().accountId) },
  }));
  router.add("GET", "/v1/me/pending-devices", (req) => ({
    json: { devices: pendingDevices(ctx, req.auth().accountId) },
  }));

  router.add("PATCH", "/v1/devices/:id", async (req) => {
    const body = await req.json();
    return {
      json: renameDevice(
        ctx,
        req.auth(),
        req.params.id!,
        String(body.name ?? ""),
      ),
    };
  });
  router.add("DELETE", "/v1/devices/:id", (req) => {
    revokeDevice(ctx, req.auth(), req.params.id!, req.ip);
    return {};
  });

  router.add("GET", "/v1/events", (req) => {
    const p = req.auth();
    return {
      sse(writer, onClose) {
        const unsubscribe = ctx.events.subscribe(
          p.accountId,
          p.deviceId,
          (e) => writer.send(e.type, e),
          () => writer.close(),
        );
        writer.send("hello", { serverId: ctx.serverId, time: ctx.clock.now() });
        const ping = setInterval(() => writer.comment("ping"), 25_000);
        onClose(() => {
          clearInterval(ping);
          unsubscribe();
        });
      },
    };
  });
}
