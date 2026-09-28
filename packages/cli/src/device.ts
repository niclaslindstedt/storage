// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The CLI as an admin device (SPEC §11.2): a P-256 signing key made here,
// registered by redeeming a console pairing, and used to answer the server's
// sign-in challenges. Also the formats a user pastes: the console's sign-in
// link, pairing payloads (oss-storage://pair?…, or an app link #oss=…) and
// exported sessions.

import {
  createPrivateKey,
  generateKeyPairSync,
  type KeyObject,
  sign,
} from "node:crypto";

import type { DeviceCredentials } from "./config.ts";

const b64u = (b: Buffer) => b.toString("base64url");

/** Raw uncompressed P-256 point (0x04 | x | y), base64url, as the API wants. */
function rawPublic(key: KeyObject): string {
  const jwk = key.export({ format: "jwk" });
  return b64u(
    Buffer.concat([
      Buffer.from([4]),
      Buffer.from(jwk.x!, "base64url"),
      Buffer.from(jwk.y!, "base64url"),
    ]),
  );
}

export type NewDeviceKeys = {
  /** PKCS#8 DER of the signing key, base64url — the secret the CLI keeps. */
  key: string;
  dskPublic: string;
  /**
   * The encryption key's public half. The API requires one, but the CLI
   * never receives an account key (it administers; it reads no data), so
   * its private half is discarded on the spot.
   */
  dekPublic: string;
};

export function newDeviceKeys(): NewDeviceKeys {
  const dsk = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const dek = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  return {
    key: b64u(dsk.privateKey.export({ format: "der", type: "pkcs8" })),
    dskPublic: rawPublic(dsk.publicKey),
    dekPublic: rawPublic(dek.publicKey),
  };
}

/** The message a device signs to sign in (docs/protocol.md). */
export function authMessage(
  serverId: string,
  deviceId: string,
  challenge: string,
): string {
  return `oss-storage/v1/auth|${serverId}|${deviceId}|${challenge}`;
}

/** ECDSA P-256 / SHA-256, IEEE P1363 (r | s), base64url. */
export function signChallenge(
  creds: Pick<DeviceCredentials, "key" | "serverId" | "deviceId">,
  challenge: string,
): string {
  const key = createPrivateKey({
    key: Buffer.from(creds.key, "base64url"),
    format: "der",
    type: "pkcs8",
  });
  return b64u(
    sign(
      "sha256",
      Buffer.from(authMessage(creds.serverId, creds.deviceId, challenge)),
      { key, dsaEncoding: "ieee-p1363" },
    ),
  );
}

// ---------------------------------------------------------------- pasted formats

export type LoginInput =
  | { kind: "token"; url: string; token: string }
  | { kind: "pairing"; url: string; code: string; name?: string; fp?: string };

/** Recognise a console sign-in link or a pairing payload. */
export function parseLoginInput(text: string): LoginInput | null {
  const input = text.trim();
  // An app link wraps the payload: <app-url>#oss=<base64url payload>.
  const wrapped = /#oss=([A-Za-z0-9_-]+)/.exec(input);
  if (wrapped)
    return parseLoginInput(Buffer.from(wrapped[1]!, "base64url").toString());
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  if (url.protocol === "oss-storage:") {
    const q = url.searchParams;
    const server = q.get("s");
    const code = q.get("c");
    if (!server || !code) return null;
    return {
      kind: "pairing",
      url: server.replace(/\/+$/, ""),
      code,
      name: q.get("n") ?? undefined,
      fp: q.get("fp") ?? undefined,
    };
  }
  if (
    (url.protocol === "http:" || url.protocol === "https:") &&
    url.pathname === "/login" &&
    url.searchParams.get("token")
  )
    return {
      kind: "token",
      url: url.origin,
      token: url.searchParams.get("token")!,
    };
  return null;
}

// ---------------------------------------------------------------- sessions

const SESSION_PREFIX = "storage-session-v1.";

export type Session = { url: string } & Omit<DeviceCredentials, "type">;

/** One opaque string holding an admin device's URL, id and key. */
export function encodeSession(s: Session): string {
  const body: Session = {
    url: s.url,
    serverId: s.serverId,
    deviceId: s.deviceId,
    key: s.key,
    ...(s.fp ? { fp: s.fp } : {}),
  };
  return SESSION_PREFIX + b64u(Buffer.from(JSON.stringify(body)));
}

export function decodeSession(text: string): Session {
  const t = text.trim();
  if (!t.startsWith(SESSION_PREFIX))
    throw new Error(
      "STORAGE_SESSION is not a session (expected the output of `storage auth export`)",
    );
  let s: Partial<Session>;
  try {
    s = JSON.parse(
      Buffer.from(t.slice(SESSION_PREFIX.length), "base64url").toString(),
    ) as Session;
  } catch {
    throw new Error("STORAGE_SESSION is damaged (not valid JSON)");
  }
  for (const k of ["url", "serverId", "deviceId", "key"] as const)
    if (typeof s[k] !== "string" || !s[k])
      throw new Error(`STORAGE_SESSION is missing ${k}`);
  return s as Session;
}
