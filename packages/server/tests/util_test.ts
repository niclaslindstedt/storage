import { describe, expect, it } from "vitest";

import { fromB64u, toB64u } from "../src/util/b64.ts";
import { ManualClock, systemClock } from "../src/util/clock.ts";
import {
  constantTimeEqual,
  newId,
  newSecret,
  sha256B64u,
} from "../src/util/random.ts";

describe("b64u", () => {
  it("round-trips arbitrary bytes without padding", () => {
    for (let n = 0; n < 40; n++) {
      const bytes = new Uint8Array(n).map((_, i) => (i * 37 + n) & 0xff);
      const text = toB64u(bytes);
      expect(text).not.toMatch(/[+/=]/);
      expect([...fromB64u(text)]).toEqual([...bytes]);
    }
  });

  it("rejects characters outside the url-safe alphabet", () => {
    expect(() => fromB64u("ab+c")).toThrow();
    expect(() => fromB64u("ab=c")).toThrow();
    expect(() => fromB64u("a")).toThrow();
  });
});

describe("random", () => {
  it("mints prefixed ids and 256-bit secrets", () => {
    const id = newId("acc");
    expect(id).toMatch(/^acc_[A-Za-z0-9_-]{22}$/);
    expect(newId("acc")).not.toBe(id);
    expect(fromB64u(newSecret())).toHaveLength(32);
  });

  it("hashes to base64url sha-256", () => {
    expect(sha256B64u("abc")).toBe(
      "ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0",
    );
  });

  it("compares in constant time", () => {
    expect(constantTimeEqual("abc", "abc")).toBe(true);
    expect(constantTimeEqual("abc", "abd")).toBe(false);
    expect(constantTimeEqual("abc", "abcd")).toBe(false);
  });
});

describe("clock", () => {
  it("manual clock can be set and advanced", () => {
    const clock = new ManualClock(1000);
    expect(clock.now()).toBe(1000);
    clock.advance(500);
    expect(clock.now()).toBe(1500);
    clock.set(10);
    expect(clock.now()).toBe(10);
  });

  it("system clock tracks Date.now", () => {
    expect(Math.abs(systemClock.now() - Date.now())).toBeLessThan(50);
  });
});
