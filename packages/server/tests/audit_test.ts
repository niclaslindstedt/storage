import { describe, expect, it } from "vitest";

import { resolveConfig } from "../src/config.ts";
import { createContext } from "../src/context.ts";
import { ManualClock } from "../src/util/clock.ts";

describe("audit log", () => {
  it("chains entries and verifies", () => {
    const ctx = createContext(resolveConfig(), { clock: new ManualClock(1) });
    ctx.audit.append({
      actor: "cli",
      action: "account.create",
      target: "acc_x",
    });
    ctx.audit.append({ actor: "acc_x", action: "device.pair", ip: "1.2.3.4" });
    expect(ctx.audit.verify()).toEqual({ ok: true, count: 2, brokenAt: null });
    expect(ctx.audit.list()).toHaveLength(2);
    expect(ctx.audit.head()).toMatch(/^[0-9a-f]{64}$/);
  });

  it("detects an edited entry", () => {
    const ctx = createContext(resolveConfig(), { clock: new ManualClock(1) });
    ctx.audit.append({ actor: "a", action: "one" });
    ctx.audit.append({ actor: "a", action: "two" });
    ctx.audit.append({ actor: "a", action: "three" });
    const second = ctx.audit.list()[1]!;
    ctx.db.run("UPDATE audit SET action = 'forged' WHERE id = ?", second.id);
    expect(ctx.audit.verify()).toEqual({
      ok: false,
      count: 1,
      brokenAt: second.id,
    });
  });

  it("detects a deleted entry", () => {
    const ctx = createContext(resolveConfig(), { clock: new ManualClock(1) });
    ctx.audit.append({ actor: "a", action: "one" });
    ctx.audit.append({ actor: "a", action: "two" });
    ctx.audit.append({ actor: "a", action: "three" });
    const [, second, third] = ctx.audit.list();
    ctx.db.run("DELETE FROM audit WHERE id = ?", second!.id);
    expect(ctx.audit.verify()).toMatchObject({
      ok: false,
      brokenAt: third!.id,
    });
  });
});
