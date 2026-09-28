import { describe, expect, it } from "vitest";

import { fileNameFrom, remotePath } from "../src/console.ts";
import { createSseParser } from "../src/sse.ts";

describe("remotePath", () => {
  it("maps the console's API onto /v1/console", () => {
    expect(remotePath("/api/overview")).toBe("/v1/console/overview");
    expect(remotePath("/api/logs?after=3&level=warn")).toBe(
      "/v1/console/logs?after=3&level=warn",
    );
    expect(remotePath("/api/accounts/acc_1/pairing")).toBe(
      "/v1/console/accounts/acc_1/pairing",
    );
    expect(remotePath("/metrics")).toBe("/v1/console/metrics");
    expect(() => remotePath("/login")).toThrow();
  });

  it("reads the offered file name", () => {
    expect(fileNameFrom('attachment; filename="storage-debug.log"', "x")).toBe(
      "storage-debug.log",
    );
    expect(fileNameFrom(null, "download")).toBe("download");
  });
});

describe("createSseParser", () => {
  it("splits events across chunks and skips comments", () => {
    const seen: [string, string][] = [];
    const p = createSseParser((name, data) => seen.push([name, data]));
    p.feed("retry: 3000\n\n: ping\n\nevent: log\nda");
    p.feed('ta: {"seq":1}\n\nevent: log\r\ndata: {"seq":2}\r\n\r\n');
    p.feed("data: a\ndata: b\n\n");
    expect(seen).toEqual([
      ["log", '{"seq":1}'],
      ["log", '{"seq":2}'],
      ["message", "a\nb"],
    ]);
  });
});
