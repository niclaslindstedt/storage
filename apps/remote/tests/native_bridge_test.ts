// The native wrapper's bridge script, run against a fake page: it must
// install hosts under exactly the names the framework and the app look for
// (a mismatch fails silently — the page just finds no host), and a request
// must make the round trip. Also guards the rule that lets this test import
// from native/ at all: the bridge files import nothing but each other.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";

import { describe, expect, it } from "vitest";

import {
  KEY_VAULT_HOST_EVENT,
  KEY_VAULT_HOST_PROPERTY,
} from "@niclaslindstedt/oss-framework/storage/selfhosted";

import { BRIDGE_SCRIPT, resolveScript } from "../native/src/bridge.ts";
import {
  BRIDGE_MESSAGE,
  isBridgeRequest,
  scriptLiteral,
} from "../native/src/wire.ts";
import {
  SCANNER_EVENT,
  SCANNER_PROPERTY,
  SHARE_EVENT,
  SHARE_PROPERTY,
} from "../src/hosts.ts";

type Host = Record<string, (...args: unknown[]) => Promise<unknown>> & {
  version: number;
};

function fakePage() {
  const posted: string[] = [];
  const events: string[] = [];
  const window: Record<string, unknown> = {
    ReactNativeWebView: { postMessage: (m: string) => posted.push(m) },
    dispatchEvent: (e: { type: string }) => events.push(e.type),
  };
  const context = {
    window,
    Event: class {
      constructor(readonly type: string) {}
    },
    Promise,
    JSON,
    Math,
    Object,
    Error,
  };
  const run = (code: string) => runInNewContext(code, context);
  run(BRIDGE_SCRIPT);
  return { window, posted, events, run };
}

describe("the bridge script", () => {
  it("installs the hosts under the names the page looks for", () => {
    const page = fakePage();
    for (const property of [
      KEY_VAULT_HOST_PROPERTY,
      SCANNER_PROPERTY,
      SHARE_PROPERTY,
    ])
      expect((page.window[property] as Host).version).toBe(1);
    const vault = page.window[KEY_VAULT_HOST_PROPERTY] as Host;
    for (const m of ["get", "put", "delete", "clear"])
      expect(typeof vault[m]).toBe("function");
    expect(typeof (page.window[SCANNER_PROPERTY] as Host).scan).toBe(
      "function",
    );
    expect(typeof (page.window[SHARE_PROPERTY] as Host).share).toBe("function");
    expect(page.events).toEqual([
      KEY_VAULT_HOST_EVENT,
      SCANNER_EVENT,
      SHARE_EVENT,
    ]);
  });

  it("runs once, even when injected again on reload", () => {
    const page = fakePage();
    page.run(BRIDGE_SCRIPT);
    expect(page.events).toHaveLength(3);
  });

  it("carries a request to the wrapper and its answer back", async () => {
    const page = fakePage();
    const vault = page.window[KEY_VAULT_HOST_PROPERTY] as Host;
    const got = vault.get!("device:dsk");
    const req = JSON.parse(page.posted[0]!) as unknown;
    expect(isBridgeRequest(req)).toBe(true);
    const r = req as { id: string; op: string; args: unknown[] };
    expect(r).toMatchObject({
      type: BRIDGE_MESSAGE,
      op: "vault.get",
      args: ["device:dsk"],
    });
    page.run(resolveScript(r.id, { ok: true, value: "c2VjcmV0" }));
    await expect(got).resolves.toBe("c2VjcmV0");

    const scan = (page.window[SCANNER_PROPERTY] as Host).scan!();
    const s = JSON.parse(page.posted[1]!) as { id: string };
    page.run(resolveScript(s.id, { ok: false, error: "camera denied" }));
    await expect(scan).rejects.toThrow("camera denied");
  });

  it("refuses malformed requests and escapes what it injects", () => {
    expect(isBridgeRequest({ type: BRIDGE_MESSAGE, id: "1", op: "eval" })).toBe(
      false,
    );
    expect(
      isBridgeRequest({ type: BRIDGE_MESSAGE, id: "", op: "scan", args: [] }),
    ).toBe(false);
    expect(scriptLiteral("</script>\u2028")).toBe('"<\\/script>\\u2028"');
  });
});

describe("import discipline", () => {
  it("bridge.ts and wire.ts import nothing from Expo or React Native", () => {
    const dir = join(import.meta.dirname, "../native/src");
    const imports = (file: string) =>
      [
        ...readFileSync(join(dir, file), "utf8").matchAll(
          /^import[^"']*["']([^"']+)["']/gm,
        ),
      ].map((m) => m[1]);
    expect(imports("wire.ts")).toEqual([]);
    expect(new Set(imports("bridge.ts"))).toEqual(new Set(["./wire"]));
  });
});
