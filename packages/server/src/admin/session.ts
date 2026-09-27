// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Admin console authentication (SPEC §11.1). A stable 256-bit token lives in
// `<data-dir>/admin.token` (0600) — whoever can read the data directory is
// already an admin. The token is exchanged for a session cookie (HttpOnly,
// SameSite=Strict, 12 h absolute / 1 h idle) bound to the token it was issued
// under, so rotating the token signs everyone out. Sessions are kept hashed,
// in memory only.

import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { isIP } from "node:net";
import { join } from "node:path";

import type { Clock } from "../util/clock.ts";
import { constantTimeEqual, newSecret, sha256B64u } from "../util/random.ts";

export const COOKIE = "storage_admin";
const TOKEN_FILE = "admin.token";
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const MAX_AGE_MS = 12 * 3600_000;
const IDLE_MS = 3600_000;
const MAX_SESSIONS = 50;
const LOGINS_PER_MINUTE = 10;

export function readAdminToken(dataDir: string): string | null {
  const file = join(dataDir, TOKEN_FILE);
  if (!existsSync(file)) return null;
  const t = readFileSync(file, "utf8").trim();
  return TOKEN_RE.test(t) ? t : null;
}

function writeToken(dataDir: string, token: string): void {
  const file = join(dataDir, TOKEN_FILE);
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${token}\n`, { mode: 0o600 });
  renameSync(tmp, file);
}

/** The data directory's admin token, created on first use. */
export function ensureAdminToken(dataDir: string): string {
  const existing = readAdminToken(dataDir);
  if (existing) return existing;
  const token = newSecret();
  writeToken(dataDir, token);
  return token;
}

/** Replace the token; every session issued under the old one dies. */
export function rotateAdminToken(dataDir: string): string {
  const token = newSecret();
  writeToken(dataDir, token);
  return token;
}

/**
 * DNS-rebinding guard: accept a Host header only when its name is an IP
 * literal or `localhost` — a rebinding attack needs a domain name.
 */
export function hostAllowed(host: string | undefined): boolean {
  if (!host) return false;
  let name = host;
  if (name.startsWith("[")) name = name.slice(1, name.indexOf("]"));
  else name = name.replace(/:\d+$/, "");
  name = name.toLowerCase();
  return (
    isIP(name) !== 0 || name === "localhost" || name.endsWith(".localhost")
  );
}

function cookieValue(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}

type Session = { created: number; seen: number; tokenHash: string };

export class AdminAuth {
  private readonly sessions = new Map<string, Session>();
  private readonly logins = new Map<string, { minute: number; n: number }>();
  private memoryToken: string | null = null;
  private readonly dataDir: string | null;
  private readonly clock: Clock;

  constructor(opts: { dataDir: string | null; clock: Clock }) {
    this.dataDir = opts.dataDir;
    this.clock = opts.clock;
    if (this.dataDir) ensureAdminToken(this.dataDir);
    else this.memoryToken = newSecret();
  }

  /** The current token (re-read from disk, so `admin --rotate` applies live). */
  token(): string {
    if (!this.dataDir) return this.memoryToken!;
    return readAdminToken(this.dataDir) ?? ensureAdminToken(this.dataDir);
  }

  checkToken(candidate: string): boolean {
    return (
      TOKEN_RE.test(candidate) && constantTimeEqual(candidate, this.token())
    );
  }

  /** At most 10 login attempts per client per minute. */
  allowLogin(client: string): boolean {
    const minute = Math.floor(this.clock.now() / 60_000);
    const e = this.logins.get(client);
    if (!e || e.minute !== minute) {
      if (this.logins.size > 1000) this.logins.clear();
      this.logins.set(client, { minute, n: 1 });
      return true;
    }
    e.n++;
    return e.n <= LOGINS_PER_MINUTE;
  }

  createSession(): { id: string; cookie: string } {
    const id = newSecret();
    const now = this.clock.now();
    if (this.sessions.size >= MAX_SESSIONS) {
      const oldest = [...this.sessions].sort(
        (a, b) => a[1].created - b[1].created,
      )[0];
      if (oldest) this.sessions.delete(oldest[0]);
    }
    this.sessions.set(sha256B64u(id), {
      created: now,
      seen: now,
      tokenHash: sha256B64u(this.token()),
    });
    return {
      id,
      cookie: `${COOKIE}=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${MAX_AGE_MS / 1000}`,
    };
  }

  /** Whether the Cookie header carries a live session (and touch it). */
  session(cookieHeader: string | undefined): boolean {
    const id = cookieValue(cookieHeader, COOKIE);
    if (!id || !TOKEN_RE.test(id)) return false;
    const key = sha256B64u(id);
    const s = this.sessions.get(key);
    if (!s) return false;
    const now = this.clock.now();
    if (
      now - s.created > MAX_AGE_MS ||
      now - s.seen > IDLE_MS ||
      s.tokenHash !== sha256B64u(this.token())
    ) {
      this.sessions.delete(key);
      return false;
    }
    s.seen = now;
    return true;
  }

  destroy(cookieHeader: string | undefined): void {
    const id = cookieValue(cookieHeader, COOKIE);
    if (id) this.sessions.delete(sha256B64u(id));
  }

  static clearCookie(): string {
    return `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`;
  }
}
