// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Where the agent device keeps its keys: its signing and key-agreement keys,
// the account key once it has one, and its session. The framework client
// asks for a "bytes" vault (SPEC §4.4) and imports everything it reads as a
// non-extractable CryptoKey, so key bytes live in this process's memory
// only while they are being imported.
//
// At rest the vault is one file, sealed with AES-256-GCM under a 256-bit
// vault key that is either
// - a separate key file (`vault.key`, the default) — keep it off backups
//   that hold `vault.json`, or on another disk; or
// - derived from a passphrase with scrypt (STORAGE_MCP_PASSPHRASE), so
//   nothing on disk opens the vault by itself.
// Both files are created 0600 in a 0700 directory and the vault refuses to
// open when anyone else can read them — the same rule ssh applies to keys.

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import type {
  KeyVault,
  VaultValue,
} from "@niclaslindstedt/oss-framework/storage/selfhosted";

const AAD = Buffer.from("storage-mcp/vault/v1");
// OWASP's scrypt recommendation (N=2^17, r=8, p=1: 128 MiB, ~0.3 s).
const SCRYPT = { N: 2 ** 17, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };

export type VaultKeySource =
  { kind: "keyfile" } | { kind: "passphrase"; passphrase: string };

type Sealed = {
  v: 1;
  kdf: "keyfile" | "scrypt";
  salt?: string;
  iv: string;
  ct: string;
};

export class VaultError extends Error {}

const b64u = (b: Uint8Array) => Buffer.from(b).toString("base64url");
const unb64u = (s: string) => new Uint8Array(Buffer.from(s, "base64url"));

/** Refuse a file or directory others can read or write (POSIX). */
export function assertPrivate(path: string, dir = false): void {
  if (process.platform === "win32" || !existsSync(path)) return;
  const st = statSync(path);
  const uid = process.getuid?.();
  if (uid !== undefined && st.uid !== uid)
    throw new VaultError(`${path} belongs to another user`);
  if (st.mode & 0o077)
    throw new VaultError(
      `${path} is accessible to other users (mode ${(st.mode & 0o777).toString(8)}): run chmod ${dir ? "700" : "600"} ${path}`,
    );
}

export function ensurePrivateDir(dir: string): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") chmodSync(dir, 0o700);
  assertPrivate(dir, true);
}

/** Write a file atomically with mode 0600. */
export function writePrivate(path: string, data: string | Uint8Array): void {
  const tmp = `${path}.${randomBytes(4).toString("hex")}.tmp`;
  writeFileSync(tmp, data, { mode: 0o600 });
  renameSync(tmp, path);
}

export type FileVault = KeyVault & {
  /** Whether the vault holds a session (the device is paired). */
  readonly exists: boolean;
  /** Delete the vault and its key file. */
  destroy(): void;
};

export function openFileVault(dir: string, source: VaultKeySource): FileVault {
  ensurePrivateDir(dir);
  const file = join(dir, "vault.json");
  const keyFile = join(dir, "vault.key");
  assertPrivate(file);
  assertPrivate(keyFile);

  let sealed: Sealed | null = existsSync(file)
    ? (JSON.parse(readFileSync(file, "utf8")) as Sealed)
    : null;
  if (sealed && sealed.v !== 1) throw new VaultError("unknown vault version");
  if (sealed && sealed.kdf === "scrypt" && source.kind !== "passphrase")
    throw new VaultError(
      "this vault is sealed with a passphrase: set STORAGE_MCP_PASSPHRASE",
    );
  if (sealed && sealed.kdf === "keyfile" && source.kind !== "keyfile")
    throw new VaultError(
      "this vault is sealed with a key file, not a passphrase: unset STORAGE_MCP_PASSPHRASE",
    );

  let salt = sealed?.salt ? unb64u(sealed.salt) : randomBytes(16);
  const deriveKey = (): Buffer => {
    if (source.kind === "passphrase") {
      if (source.passphrase.length < 12)
        throw new VaultError("the passphrase must be at least 12 characters");
      return scryptSync(source.passphrase.normalize("NFKC"), salt, 32, SCRYPT);
    }
    if (!existsSync(keyFile)) {
      if (sealed)
        throw new VaultError(`the vault key file ${keyFile} is missing`);
      writePrivate(keyFile, b64u(randomBytes(32)));
    }
    const key = Buffer.from(readFileSync(keyFile, "utf8").trim(), "base64url");
    if (key.length !== 32)
      throw new VaultError(`${keyFile} is not a vault key`);
    return key;
  };
  let key: Buffer | null = null;
  const vaultKey = () => (key ??= deriveKey());

  let entries: Map<string, string>;
  if (sealed) {
    try {
      const d = createDecipheriv("aes-256-gcm", vaultKey(), unb64u(sealed.iv));
      d.setAAD(AAD);
      const ct = unb64u(sealed.ct);
      d.setAuthTag(ct.subarray(ct.length - 16));
      const plain = Buffer.concat([
        d.update(ct.subarray(0, ct.length - 16)),
        d.final(),
      ]);
      entries = new Map(
        Object.entries(
          JSON.parse(plain.toString("utf8")) as Record<string, string>,
        ),
      );
    } catch (err) {
      if (err instanceof VaultError) throw err;
      throw new VaultError(
        source.kind === "passphrase"
          ? "cannot open the vault: wrong passphrase?"
          : "cannot open the vault: the key file does not match",
      );
    }
  } else entries = new Map();

  const save = () => {
    const iv = randomBytes(12);
    const c = createCipheriv("aes-256-gcm", vaultKey(), iv);
    c.setAAD(AAD);
    const ct = Buffer.concat([
      c.update(JSON.stringify(Object.fromEntries(entries)), "utf8"),
      c.final(),
      c.getAuthTag(),
    ]);
    sealed = {
      v: 1,
      kdf: source.kind === "passphrase" ? "scrypt" : "keyfile",
      ...(source.kind === "passphrase" ? { salt: b64u(salt) } : {}),
      iv: b64u(iv),
      ct: b64u(ct),
    };
    writePrivate(file, JSON.stringify(sealed));
  };

  return {
    kind: "bytes",
    get exists() {
      return entries.has("session");
    },
    async get(id) {
      const v = entries.get(id);
      return v === undefined ? null : unb64u(v);
    },
    async put(id, value: VaultValue) {
      if (!(value instanceof Uint8Array))
        throw new VaultError("this vault stores bytes only");
      entries.set(id, b64u(value));
      save();
    },
    async delete(id) {
      if (entries.delete(id)) save();
    },
    async clear(prefix = "") {
      let changed = false;
      for (const k of [...entries.keys()])
        if (k.startsWith(prefix)) changed = entries.delete(k) || changed;
      if (changed) save();
    },
    destroy() {
      entries.clear();
      rmSync(file, { force: true });
      rmSync(keyFile, { force: true });
      key = null;
      salt = randomBytes(16);
      sealed = null;
    },
  };
}
