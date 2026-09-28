// Shared test fixtures: a context on an in-memory database and a manual
// clock, and a device key pair that can sign auth challenges the way the
// framework client does.

import { webcrypto } from "node:crypto";

import { type ConfigOverrides, resolveConfig } from "../src/config.ts";
import { type Ctx, createContext } from "../src/context.ts";
import { authMessage } from "../src/crypto.ts";
import { toB64u } from "../src/util/b64.ts";
import { ManualClock } from "../src/util/clock.ts";

const subtle = webcrypto.subtle;

export function testContext(overrides: ConfigOverrides = {}): Ctx & {
  clock: ManualClock;
} {
  const clock = new ManualClock(1_800_000_000_000);
  const ctx = createContext(resolveConfig(overrides), { clock });
  return ctx as Ctx & { clock: ManualClock };
}

export type TestDeviceKeys = {
  dskPublic: string;
  dekPublic: string;
  sign(message: string): Promise<string>;
};

export async function deviceKeys(): Promise<TestDeviceKeys> {
  const dsk = await subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign", "verify"],
  );
  const dek = await subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    false,
    ["deriveBits"],
  );
  return {
    dskPublic: toB64u(
      new Uint8Array(await subtle.exportKey("raw", dsk.publicKey)),
    ),
    dekPublic: toB64u(
      new Uint8Array(await subtle.exportKey("raw", dek.publicKey)),
    ),
    async sign(message: string) {
      const sig = await subtle.sign(
        { name: "ECDSA", hash: "SHA-256" },
        dsk.privateKey,
        new TextEncoder().encode(message),
      );
      return toB64u(new Uint8Array(sig));
    },
  };
}

export async function signChallenge(
  keys: TestDeviceKeys,
  serverId: string,
  deviceId: string,
  challenge: string,
): Promise<string> {
  return keys.sign(authMessage(serverId, deviceId, challenge));
}

/** A syntactically valid OSE1 envelope sealed under `epoch` (content is noise). */
export function envelope(epoch = 1, bodyBytes = 16, fill = 7): Uint8Array {
  const out = new Uint8Array(9 + 12 + bodyBytes + 16).fill(fill);
  out.set([0x4f, 0x53, 0x45, 0x31, 1], 0);
  new DataView(out.buffer).setUint32(5, epoch);
  return out;
}

export function envelopeB64u(epoch = 1, bodyBytes = 16, fill = 7): string {
  return toB64u(envelope(epoch, bodyBytes, fill));
}

import { createAccount } from "../src/services/accounts.ts";
import { insertDevice } from "../src/services/devices.ts";
import type { AccountRole, Principal } from "../src/services/principal.ts";

/** An account with one device, as the principal a request would carry. */
export function principal(
  ctx: Ctx,
  name: string,
  role: AccountRole = "member",
): Principal {
  const acc = createAccount(ctx, { name, role });
  const deviceId = insertDevice(
    ctx,
    acc.id,
    {
      name: `${name}-device`,
      platform: "test",
      dskPublic: "x",
      dekPublic: "y",
    },
    null,
  );
  return {
    accountId: acc.id,
    accountName: name,
    deviceId,
    role,
    console: false,
  };
}

/** A fake key wrap (opaque base64url, as the server sees every wrap). */
export const WRAP = "d3JhcHBlZC1rZXk";
