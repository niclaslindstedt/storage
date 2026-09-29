// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Saved contexts (like Docker contexts and gh's hosts): each is a server URL
// plus credentials — the admin token, or an admin device's id and signing
// key. Kept in <config-dir>/config.json, written atomically with mode 0600
// in a 0700 directory, because it holds secrets.

import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import type { Env } from "./env.ts";

/** Logged in to the console listener with the admin token. */
export type TokenCredentials = { type: "token"; token: string };

/** Logged in as an admin device (SPEC §11.2) over the device API. */
export type DeviceCredentials = {
  type: "device";
  serverId: string;
  deviceId: string;
  /** The device's P-256 signing key, PKCS#8 DER, base64url. */
  key: string;
  /** Pinned TLS key (SPKI SHA-256, base64url) for a self-signed server. */
  fp?: string;
};

export type Credentials = TokenCredentials | DeviceCredentials;

export type Context = {
  url: string;
  /** The server's display name, when known. */
  server?: string;
  /** The admin account an admin device belongs to. */
  account?: string;
  createdAt: string;
  auth: Credentials;
};

export type ConfigFile = {
  current: string | null;
  contexts: Record<string, Context>;
};

export function defaultConfigDir(
  env: Env,
  os: NodeJS.Platform = process.platform,
): string {
  if (env.STORAGE_CONFIG_DIR) return env.STORAGE_CONFIG_DIR;
  const home = env.HOME || homedir();
  if (os === "win32")
    return join(env.APPDATA ?? join(home, "AppData", "Roaming"), "storage");
  return join(env.XDG_CONFIG_HOME || join(home, ".config"), "storage");
}

export class ConfigStore {
  readonly file: string;

  constructor(readonly dir: string) {
    this.file = join(dir, "config.json");
  }

  read(): ConfigFile {
    if (!existsSync(this.file)) return { current: null, contexts: {} };
    let parsed: Partial<ConfigFile>;
    try {
      parsed = JSON.parse(readFileSync(this.file, "utf8")) as ConfigFile;
    } catch (err) {
      throw new Error(
        `${this.file} is not valid JSON (${(err as Error).message}); fix or delete it`,
        { cause: err },
      );
    }
    return {
      current: parsed.current ?? null,
      contexts: parsed.contexts ?? {},
    };
  }

  write(config: ConfigFile): void {
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    const tmp = `${this.file}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(config, null, 2)}\n`, {
      mode: 0o600,
    });
    renameSync(tmp, this.file);
    // An existing file keeps its old mode through writeFileSync; be sure.
    if (process.platform !== "win32") chmodSync(this.file, 0o600);
  }

  update(change: (config: ConfigFile) => void): ConfigFile {
    const config = this.read();
    change(config);
    this.write(config);
    return config;
  }
}

/** A context name from a server name or URL host: lowercase, [a-z0-9-]. */
export function contextName(base: string, taken: Iterable<string>): string {
  const slug =
    base
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "server";
  const used = new Set(taken);
  if (!used.has(slug)) return slug;
  for (let n = 2; ; n++) if (!used.has(`${slug}-${n}`)) return `${slug}-${n}`;
}

export const CONTEXT_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

type CachedToken = { token: string; expiresAt: number };

/**
 * Admin-device access tokens (10 minutes) kept between runs in
 * <config-dir>/tokens.json (0600), so a script does not sign in on every
 * call and trip the server's rate limit on sign-ins. Best effort: an
 * unwritable directory (a read-only container) just means signing in again.
 */
export class TokenCache {
  readonly file: string;

  constructor(
    readonly dir: string,
    private readonly now: () => number = Date.now,
  ) {
    this.file = join(dir, "tokens.json");
  }

  private load(): Record<string, CachedToken> {
    try {
      return JSON.parse(readFileSync(this.file, "utf8")) as Record<
        string,
        CachedToken
      >;
    } catch {
      return {};
    }
  }

  private store(all: Record<string, CachedToken>): void {
    try {
      mkdirSync(this.dir, { recursive: true, mode: 0o700 });
      const tmp = `${this.file}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify(all), { mode: 0o600 });
      renameSync(tmp, this.file);
    } catch {
      // Read-only or missing config directory: nothing is cached.
    }
  }

  get(key: string): string | null {
    const t = this.load()[key];
    // Leave a margin so a token does not lapse mid-command.
    return t && t.expiresAt - 30_000 > this.now() ? t.token : null;
  }

  set(key: string, token: string, expiresAt: number): void {
    const all = this.load();
    for (const [k, v] of Object.entries(all))
      if (v.expiresAt <= this.now()) delete all[k];
    all[key] = { token, expiresAt };
    this.store(all);
  }

  delete(key: string): void {
    const all = this.load();
    if (!(key in all)) return;
    delete all[key];
    this.store(all);
  }
}
