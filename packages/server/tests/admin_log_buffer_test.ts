import { describe, expect, it } from "vitest";

import { LogBuffer, teeLogger } from "../src/admin/log-buffer.ts";
import { createMemoryLogger } from "../src/log.ts";
import { ManualClock } from "../src/util/clock.ts";

describe("LogBuffer", () => {
  it("records every level from a tee'd logger and still forwards it", () => {
    const clock = new ManualClock(1_000);
    const buffer = new LogBuffer({ clock, capacity: 10 });
    const inner = createMemoryLogger();
    const log = teeLogger(inner, buffer);
    log.info("hello");
    log.warn("careful", new Error("boom"));
    log.debug("details");
    expect(inner.lines).toEqual([
      "INFO hello",
      "WARN careful (Error: boom)",
      "DEBUG details",
    ]);
    expect(buffer.list().map((e) => [e.seq, e.level, e.message])).toEqual([
      [1, "info", "hello"],
      [2, "warn", "careful (Error: boom)"],
      [3, "debug", "details"],
    ]);
    expect(buffer.list()[0]!.at).toBe(1_000);
  });

  it("keeps only the newest entries", () => {
    const buffer = new LogBuffer({ capacity: 3 });
    for (let i = 1; i <= 5; i++) buffer.push("info", `m${i}`);
    expect(buffer.list().map((e) => e.message)).toEqual(["m3", "m4", "m5"]);
  });

  it("filters by sequence, minimum level and text", () => {
    const buffer = new LogBuffer();
    buffer.push("debug", "db opened");
    buffer.push("info", "listening");
    buffer.push("warn", "port mapping failed");
    buffer.push("error", "request failed");
    expect(buffer.list({ after: 2 }).map((e) => e.seq)).toEqual([3, 4]);
    expect(buffer.list({ level: "warn" }).map((e) => e.level)).toEqual([
      "warn",
      "error",
    ]);
    expect(buffer.list({ q: "PORT" }).map((e) => e.seq)).toEqual([3]);
    expect(buffer.list({ limit: 1 }).map((e) => e.seq)).toEqual([4]);
  });

  it("notifies subscribers until they unsubscribe", () => {
    const buffer = new LogBuffer();
    const seen: string[] = [];
    const off = buffer.subscribe((e) => seen.push(e.message));
    buffer.push("info", "a");
    off();
    buffer.push("info", "b");
    expect(seen).toEqual(["a"]);
    expect(buffer.subscribers).toBe(0);
  });

  it("counts warnings and errors since start", () => {
    const buffer = new LogBuffer({ capacity: 1 });
    buffer.push("warn", "w");
    buffer.push("error", "e");
    buffer.push("error", "e2");
    expect(buffer.counts()).toEqual({ warn: 1, error: 2 });
  });
});
