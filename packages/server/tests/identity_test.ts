import { describe, expect, it } from "vitest";

import { ApiError } from "../src/errors.ts";
import {
  accountUsage,
  createAccount,
  getAccountKeys,
  listAccounts,
  setAccountKeys,
  updateAccount,
} from "../src/services/accounts.ts";
import {
  authenticate,
  createChallenge,
  issueToken,
  revokeToken,
} from "../src/services/auth.ts";
import {
  listDevices,
  pendingDevices,
  renameDevice,
  revokeDevice,
} from "../src/services/devices.ts";
import { createPairing, redeemPairing } from "../src/services/pairing.ts";
import { newSecret } from "../src/util/random.ts";
import { deviceKeys, signChallenge, testContext } from "./helpers.ts";

async function expectApiError(
  p: Promise<unknown> | (() => unknown),
  code: string,
) {
  try {
    await (typeof p === "function" ? p() : p);
  } catch (err) {
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe(code);
    return err as ApiError;
  }
  throw new Error(`expected ApiError ${code}`);
}

describe("accounts", () => {
  it("keeps at least one active admin", async () => {
    const ctx = testContext();
    const a = createAccount(ctx, { name: "root", role: "admin" });
    await expectApiError(
      () => updateAccount(ctx, a.id, { role: "member" }, "cli"),
      "conflict",
    );
    await expectApiError(
      () => updateAccount(ctx, a.id, { disabled: true }, "cli"),
      "conflict",
    );
  });

  it("creates accounts with unique, case-insensitive names", async () => {
    const ctx = testContext();
    const a = createAccount(ctx, { name: "Alice", role: "admin" });
    expect(a).toMatchObject({ name: "Alice", role: "admin", quotaBytes: null });
    await expectApiError(
      () => createAccount(ctx, { name: "alice", role: "member" }),
      "conflict",
    );
    await expectApiError(
      () => createAccount(ctx, { name: "", role: "member" }),
      "invalid_request",
    );
    await expectApiError(
      () => createAccount(ctx, { name: "bad\u0000name", role: "member" }),
      "invalid_request",
    );
    expect(listAccounts(ctx).map((x) => x.name)).toEqual(["Alice"]);
  });

  it("applies the default quota and updates", () => {
    const ctx = testContext({ defaultQuotaBytes: 1000 });
    const a = createAccount(ctx, { name: "bob", role: "member" });
    expect(a.quotaBytes).toBe(1000);
    const b = updateAccount(
      ctx,
      a.id,
      { quotaBytes: null, role: "guest" },
      "cli",
    );
    expect(b).toMatchObject({ quotaBytes: null, role: "guest" });
    expect(accountUsage(ctx, a.id)).toBe(0);
  });
});

describe("pairing", () => {
  it("enrols a device into an existing account exactly once", async () => {
    const ctx = testContext();
    const acc = createAccount(ctx, { name: "alice", role: "admin" });
    const { code, expiresAt } = createPairing(
      ctx,
      { accountId: acc.id },
      "cli",
    );
    expect(expiresAt).toBe(ctx.clock.now() + 600_000);
    const keys = await deviceKeys();
    const device = { name: "Phone", platform: "web", ...keys };
    const out = await redeemPairing(
      ctx,
      { code: code!, device },
      {
        ip: "10.0.0.2",
        origin: "https://notes.example",
      },
    );
    expect(out.accountId).toBe(acc.id);
    expect(out.deviceId).toMatch(/^dev_/);
    await expectApiError(
      redeemPairing(ctx, { code: code!, device }, { ip: null, origin: null }),
      "unauthenticated",
    );
    expect(ctx.db.get("SELECT origin FROM origins")).toEqual({
      origin: "https://notes.example",
    });
    expect(ctx.audit.list().map((e) => e.action)).toContain("device.pair");
  });

  it("creates a new account when the pairing says so", async () => {
    const ctx = testContext();
    const { code } = createPairing(
      ctx,
      { newAccount: { name: "carol", role: "member" } },
      "cli",
    );
    const out = await redeemPairing(
      ctx,
      {
        code: code!,
        device: { name: "Laptop", platform: "web", ...(await deviceKeys()) },
      },
      { ip: null, origin: null },
    );
    expect(out.account).toMatchObject({ name: "carol", role: "member" });
  });

  it("rejects expired codes and malformed device keys", async () => {
    const ctx = testContext();
    const acc = createAccount(ctx, { name: "a", role: "member" });
    const { code } = createPairing(ctx, { accountId: acc.id }, "cli");
    await expectApiError(
      redeemPairing(
        ctx,
        {
          code: code!,
          device: {
            name: "x",
            platform: "web",
            dskPublic: "AAAA",
            dekPublic: "AAAA",
          },
        },
        { ip: null, origin: null },
      ),
      "invalid_request",
    );
    ctx.clock.advance(601_000);
    await expectApiError(
      redeemPairing(
        ctx,
        {
          code: code!,
          device: { name: "x", platform: "web", ...(await deviceKeys()) },
        },
        { ip: null, origin: null },
      ),
      "unauthenticated",
    );
  });

  it("accepts a client-derived code and hands back the transfer blob", async () => {
    const ctx = testContext();
    const acc = createAccount(ctx, { name: "a", role: "member" });
    const code = newSecret();
    const res = createPairing(
      ctx,
      { accountId: acc.id, code, transfer: "c2VhbGVk" },
      acc.id,
    );
    expect(res.code).toBeUndefined();
    const out = await redeemPairing(
      ctx,
      { code, device: { name: "x", platform: "web", ...(await deviceKeys()) } },
      { ip: null, origin: null },
    );
    expect(out.transfer).toBe("c2VhbGVk");
  });
});

describe("auth", () => {
  async function paired() {
    const ctx = testContext();
    const acc = createAccount(ctx, { name: "alice", role: "admin" });
    const { code } = createPairing(ctx, { accountId: acc.id }, "cli");
    const keys = await deviceKeys();
    const { deviceId } = await redeemPairing(
      ctx,
      { code: code!, device: { name: "Phone", platform: "ios", ...keys } },
      { ip: null, origin: null },
    );
    return { ctx, acc, keys, deviceId };
  }

  it("issues a token for a valid signature over a fresh challenge", async () => {
    const { ctx, keys, deviceId, acc } = await paired();
    const { challenge } = createChallenge(ctx, deviceId);
    const signature = await signChallenge(
      keys,
      ctx.serverId,
      deviceId,
      challenge,
    );
    const { token, expiresAt } = await issueToken(
      ctx,
      { deviceId, challenge, signature },
      null,
    );
    expect(expiresAt).toBe(ctx.clock.now() + 600_000);
    const p = authenticate(ctx, token);
    expect(p).toMatchObject({ accountId: acc.id, deviceId, role: "admin" });
    // challenges are single use
    await expectApiError(
      issueToken(ctx, { deviceId, challenge, signature }, null),
      "unauthenticated",
    );
    // tokens expire
    ctx.clock.advance(600_001);
    expect(authenticate(ctx, token)).toBeNull();
  });

  it("rejects a signature from another key or for another server", async () => {
    const { ctx, deviceId } = await paired();
    const other = await deviceKeys();
    const { challenge } = createChallenge(ctx, deviceId);
    const bad = await signChallenge(other, ctx.serverId, deviceId, challenge);
    await expectApiError(
      issueToken(ctx, { deviceId, challenge, signature: bad }, null),
      "unauthenticated",
    );
  });

  it("logs out and revokes devices", async () => {
    const { ctx, keys, deviceId, acc } = await paired();
    const { challenge } = createChallenge(ctx, deviceId);
    const signature = await signChallenge(
      keys,
      ctx.serverId,
      deviceId,
      challenge,
    );
    const { token } = await issueToken(
      ctx,
      { deviceId, challenge, signature },
      null,
    );
    revokeToken(ctx, token);
    expect(authenticate(ctx, token)).toBeNull();

    const c2 = createChallenge(ctx, deviceId);
    const t2 = await issueToken(
      ctx,
      {
        deviceId,
        challenge: c2.challenge,
        signature: await signChallenge(
          keys,
          ctx.serverId,
          deviceId,
          c2.challenge,
        ),
      },
      null,
    );
    const principal = authenticate(ctx, t2.token)!;
    revokeDevice(ctx, principal, deviceId, null);
    expect(authenticate(ctx, t2.token)).toBeNull();
    await expectApiError(
      () => createChallenge(ctx, deviceId),
      "unauthenticated",
    );
    expect(listDevices(ctx, acc.id)[0]!.revokedAt).not.toBeNull();
  });

  it("disabled accounts cannot authenticate", async () => {
    const { ctx, keys, deviceId, acc } = await paired();
    const { challenge } = createChallenge(ctx, deviceId);
    const signature = await signChallenge(
      keys,
      ctx.serverId,
      deviceId,
      challenge,
    );
    const { token } = await issueToken(
      ctx,
      { deviceId, challenge, signature },
      null,
    );
    createAccount(ctx, { name: "second-admin", role: "admin" });
    updateAccount(ctx, acc.id, { disabled: true }, "cli");
    expect(authenticate(ctx, token)).toBeNull();
  });
});

describe("account keys and devices", () => {
  it("stores the AEK once and per-device wraps; lists pending devices", async () => {
    const ctx = testContext();
    const acc = createAccount(ctx, { name: "a", role: "member" });
    const pair = async (name: string) => {
      const { code } = createPairing(ctx, { accountId: acc.id }, "cli");
      return redeemPairing(
        ctx,
        {
          code: code!,
          device: { name, platform: "web", ...(await deviceKeys()) },
        },
        { ip: null, origin: null },
      );
    };
    const d1 = await pair("one");
    const d2 = await pair("two");
    const aekPublic = (await deviceKeys()).dekPublic;
    const principal1 = {
      accountId: acc.id,
      deviceId: d1.deviceId,
      role: "member" as const,
      accountName: "a",
      console: false,
      scope: null,
    };
    await setAccountKeys(ctx, principal1, {
      aekPublic,
      recoveryWrap: "cmVjb3Zlcnk",
      deviceWraps: { [d1.deviceId]: "d3JhcDE" },
    });
    expect(getAccountKeys(ctx, acc.id, d1.deviceId)).toEqual({
      aekPublic,
      recoveryWrap: "cmVjb3Zlcnk",
      deviceWrap: "d3JhcDE",
    });
    const pending = pendingDevices(ctx, acc.id);
    expect(pending.map((d) => d.id)).toEqual([d2.deviceId]);
    expect(pending[0]!.safetyCode).toMatch(/^\d{5}( \d{5}){4}$/);

    // the AEK cannot be silently replaced
    await expectApiError(
      setAccountKeys(ctx, principal1, {
        aekPublic: (await deviceKeys()).dekPublic,
      }),
      "conflict",
    );
    // wraps for devices of another account are refused
    await expectApiError(
      setAccountKeys(ctx, principal1, {
        deviceWraps: { dev_AAAAAAAAAAAAAAAAAAAAAA: "eA" },
      }),
      "invalid_request",
    );
    await setAccountKeys(ctx, principal1, {
      deviceWraps: { [d2.deviceId]: "d3JhcDI" },
    });
    expect(pendingDevices(ctx, acc.id)).toEqual([]);

    renameDevice(ctx, principal1, d2.deviceId, "renamed");
    expect(
      listDevices(ctx, acc.id).find((d) => d.id === d2.deviceId)!.name,
    ).toBe("renamed");
  });
});
