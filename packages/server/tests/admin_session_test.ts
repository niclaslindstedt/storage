import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  AdminAuth,
  ensureAdminToken,
  hostAllowed,
  readAdminToken,
  rotateAdminToken,
} from "../src/admin/session.ts";
import { ManualClock } from "../src/util/clock.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const tempDir = () => {
  const d = mkdtempSync(join(tmpdir(), "storage-admin-"));
  dirs.push(d);
  return d;
};

describe("admin token file", () => {
  it("is created once, private, 256-bit, and reused", () => {
    const dir = tempDir();
    expect(readAdminToken(dir)).toBeNull();
    const t = ensureAdminToken(dir);
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(statSync(join(dir, "admin.token")).mode & 0o777).toBe(0o600);
    expect(ensureAdminToken(dir)).toBe(t);
    expect(readAdminToken(dir)).toBe(t);
  });

  it("rotates to a new token", () => {
    const dir = tempDir();
    const t = ensureAdminToken(dir);
    const r = rotateAdminToken(dir);
    expect(r).not.toBe(t);
    expect(readAdminToken(dir)).toBe(r);
  });

  it("ignores a malformed token file rather than accepting it", () => {
    const dir = tempDir();
    writeFileSync(join(dir, "admin.token"), "short\n", { mode: 0o600 });
    expect(readAdminToken(dir)).toBeNull();
  });
});

describe("AdminAuth", () => {
  function auth(dir: string | null = null) {
    const clock = new ManualClock(1_800_000_000_000);
    return { clock, auth: new AdminAuth({ dataDir: dir, clock }) };
  }

  it("accepts only the current token", () => {
    const { auth: a } = auth();
    expect(a.checkToken(a.token())).toBe(true);
    expect(a.checkToken("x".repeat(43))).toBe(false);
    expect(a.checkToken("")).toBe(false);
  });

  it("issues sessions that expire when idle and after 12 hours", () => {
    const { auth: a, clock } = auth();
    const s = a.createSession();
    expect(s.cookie).toMatch(
      /^storage_admin=[A-Za-z0-9_-]{43}; HttpOnly; SameSite=Strict; Path=\/; Max-Age=43200$/,
    );
    const header = `other=1; storage_admin=${s.id}`;
    expect(a.session(header)).toBe(true);
    clock.advance(59 * 60_000);
    expect(a.session(header)).toBe(true); // touched
    clock.advance(61 * 60_000);
    expect(a.session(header)).toBe(false); // idle > 1 h

    const s2 = a.createSession();
    for (let i = 0; i < 14; i++) {
      clock.advance(55 * 60_000);
      a.session(`storage_admin=${s2.id}`);
    }
    expect(a.session(`storage_admin=${s2.id}`)).toBe(false); // > 12 h
  });

  it("logout destroys the session", () => {
    const { auth: a } = auth();
    const s = a.createSession();
    a.destroy(`storage_admin=${s.id}`);
    expect(a.session(`storage_admin=${s.id}`)).toBe(false);
  });

  it("rotating the token file invalidates existing sessions", () => {
    const dir = tempDir();
    const { auth: a } = auth(dir);
    const old = a.token();
    const s = a.createSession();
    expect(a.session(`storage_admin=${s.id}`)).toBe(true);
    rotateAdminToken(dir);
    expect(a.checkToken(old)).toBe(false);
    expect(a.session(`storage_admin=${s.id}`)).toBe(false);
  });

  it("rate limits failed logins per client", () => {
    const { auth: a, clock } = auth();
    for (let i = 0; i < 10; i++) expect(a.allowLogin("1.2.3.4")).toBe(true);
    expect(a.allowLogin("1.2.3.4")).toBe(false);
    expect(a.allowLogin("5.6.7.8")).toBe(true);
    clock.advance(60_000);
    expect(a.allowLogin("1.2.3.4")).toBe(true);
  });
});

describe("hostAllowed (DNS-rebinding guard)", () => {
  it.each([
    ["127.0.0.1:8081", true],
    ["localhost:8081", true],
    ["admin.localhost", true],
    ["[::1]:8081", true],
    ["192.168.1.20:8081", true],
    ["[fd00::2]", true],
    ["evil.example.com:8081", false],
    ["127.0.0.1.nip.io", false],
    ["", false],
    [undefined, false],
  ])("%s → %s", (host, ok) => {
    expect(hostAllowed(host)).toBe(ok);
  });
});
