// The CLI's building blocks: argument parsing, .env files, output helpers,
// device keys and pasted formats, the config store and TLS key pinning.

import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:https";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  authMessage as serverAuthMessage,
  verifySignature,
} from "../../server/src/crypto.ts";
import { generateP256, selfSigned } from "../../server/src/tls/x509.ts";
import { parseArgs, resolveInvocation, UsageError } from "../src/args.ts";
import { consolePath, ConsoleClient } from "../src/client.ts";
import { ConfigStore, contextName, TokenCache } from "../src/config.ts";
import {
  authMessage,
  decodeSession,
  encodeSession,
  newDeviceKeys,
  parseLoginInput,
  signChallenge,
} from "../src/device.ts";
import { loadEnv, parseDotenv, secret } from "../src/env.ts";
import { NetworkError, send } from "../src/http.ts";
import {
  bytes,
  parseSize,
  renderTemplate,
  table,
  when,
} from "../src/output.ts";
import { GLOBAL_FLAGS, type FlagSpec } from "../src/spec.ts";

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), "storage-cli-"));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("parseArgs", () => {
  const specs: FlagSpec[] = [
    { name: "quiet", short: "q", type: "bool", description: "" },
    { name: "yes", short: "y", type: "bool", description: "" },
    { name: "tail", short: "n", type: "int", description: "" },
    { name: "field", short: "f", type: "list", description: "" },
    { name: "role", type: "string", description: "" },
  ];

  it("reads long, short, grouped, attached and negated flags", () => {
    const a = parseArgs(
      [
        "ls",
        "-qy",
        "-n5",
        "--role=admin",
        "-f",
        "a=1",
        "--field",
        "b=2",
        "--no-quiet",
        "--",
        "-x",
      ],
      specs,
    );
    expect(a.positionals).toEqual(["ls", "-x"]);
    expect(a.flags).toEqual({
      quiet: false,
      yes: true,
      tail: 5,
      role: "admin",
      field: ["a=1", "b=2"],
    });
  });

  it("rejects unknown flags, missing values and bad integers", () => {
    expect(() => parseArgs(["--nope"], specs)).toThrow(UsageError);
    expect(() => parseArgs(["-z"], specs)).toThrow("unknown flag -z");
    expect(() => parseArgs(["--role"], specs)).toThrow("needs a value");
    expect(() => parseArgs(["-n", "x"], specs)).toThrow("integer");
    expect(() => parseArgs(["--quiet=maybe"], specs)).toThrow("takes no value");
  });

  it("finds the command and subcommand after leading global flags", () => {
    const inv = resolveInvocation([
      "-c",
      "home",
      "--debug",
      "accounts",
      "list",
      "--json",
    ]);
    expect(inv.command?.name).toBe("account");
    expect(inv.sub?.name).toBe("ls");
    expect(inv.named).toBe(true);
    expect(inv.leading).toEqual(["-c", "home", "--debug"]);
    expect(inv.rest).toEqual(["--json"]);
    const logs = resolveInvocation(["logs", "-f"]);
    expect(logs.sub?.name).toBe("show");
    expect(logs.named).toBe(false);
    expect(() => resolveInvocation(["account", "frob"])).toThrow(
      "unknown account subcommand",
    );
    expect(() => resolveInvocation(["frob"])).toThrow("unknown command");
    expect(GLOBAL_FLAGS.map((f) => f.name)).toContain("env-file");
  });
});

describe(".env files", () => {
  it("parses comments, export, quotes, escapes and multi-line values", () => {
    const env = parseDotenv(
      [
        "# comment",
        "export STORAGE_URL=http://127.0.0.1:8081  # trailing",
        "STORAGE_TOKEN='abc#def'",
        'MULTI="line one',
        'line two\\tend"',
        "EMPTY=",
        "not a line",
      ].join("\n"),
    );
    expect(env).toEqual({
      STORAGE_URL: "http://127.0.0.1:8081",
      STORAGE_TOKEN: "abc#def",
      MULTI: "line one\nline two\tend",
      EMPTY: "",
    });
  });

  it("layers the process environment over files; explicit files must exist", () => {
    const d = tmp();
    writeFileSync(join(d, ".env"), "A=file\nB=file\n");
    writeFileSync(join(d, "other.env"), "B=other\nC=other\n");
    expect(loadEnv({ A: "process" }, undefined, d).env).toMatchObject({
      A: "process",
      B: "file",
    });
    const both = loadEnv({}, ["other.env"], d);
    expect(both.env).toEqual({ B: "other", C: "other" });
    expect(() => loadEnv({}, ["missing.env"], d)).toThrow("env file not found");
    expect(loadEnv({}, undefined, tmp()).loaded).toEqual([]);
  });

  it("reads NAME_FILE indirections", () => {
    const d = tmp();
    writeFileSync(join(d, "token"), "s3cret\n");
    expect(secret({ STORAGE_TOKEN_FILE: "token" }, "STORAGE_TOKEN", d)).toBe(
      "s3cret",
    );
    expect(
      secret(
        { STORAGE_TOKEN: "direct", STORAGE_TOKEN_FILE: "token" },
        "STORAGE_TOKEN",
        d,
      ),
    ).toBe("direct");
    expect(() =>
      secret({ STORAGE_TOKEN_FILE: "nope" }, "STORAGE_TOKEN", d),
    ).toThrow("missing file");
  });
});

describe("output", () => {
  it("formats and parses sizes", () => {
    expect(bytes(0)).toBe("0 B");
    expect(bytes(1536)).toBe("1.5 KiB");
    expect(bytes(null)).toBe("—");
    expect(parseSize("10G")).toBe(10 * 1024 ** 3);
    expect(parseSize("500MiB")).toBe(500 * 1024 ** 2);
    expect(parseSize("123")).toBe(123);
    expect(() => parseSize("ten")).toThrow("not a size");
  });

  it("aligns tables on a terminal and tab-separates them otherwise", () => {
    const rows = [
      { a: "x", b: "long value" },
      { a: "yyyy", b: "z" },
    ];
    const cols = [
      { header: "a", value: (r: (typeof rows)[0]) => r.a },
      { header: "b", value: (r: (typeof rows)[0]) => r.b },
    ];
    expect(table(rows, cols, true)).toBe(
      "A      B\nx      long value\nyyyy   z",
    );
    expect(table(rows, cols, false)).toBe("x\tlong value\nyyyy\tz");
  });

  it("renders templates and times", () => {
    const item = { id: "a", n: { deep: 2 }, list: [1] };
    expect(
      renderTemplate("{{.id}}\\t{{.n.deep}} {{json .list}} {{.missing}}", item),
    ).toBe("a\t2 [1] ");
    expect(renderTemplate("{{json .}}", { x: 1 })).toBe('{"x":1}');
    const now = Date.UTC(2026, 0, 1);
    expect(when(now - 5 * 60_000, true, now)).toBe("5 minutes ago");
    expect(when(now + 3 * 86400_000, true, now)).toBe("in 3 days");
    expect(when(now, false, now)).toBe("2026-01-01T00:00:00.000Z");
    expect(when(null, true, now)).toBe("never");
  });
});

describe("device keys and pasted formats", () => {
  it("signs challenges the server verifies", async () => {
    const keys = newDeviceKeys();
    expect(Buffer.from(keys.dskPublic, "base64url")).toHaveLength(65);
    expect(authMessage("srv", "dev", "ch")).toBe(
      serverAuthMessage("srv", "dev", "ch"),
    );
    const creds = { key: keys.key, serverId: "srv_1", deviceId: "dev_1" };
    const signature = signChallenge(creds, "challenge");
    expect(
      await verifySignature(
        keys.dskPublic,
        signature,
        serverAuthMessage("srv_1", "dev_1", "challenge"),
      ),
    ).toBe(true);
    expect(
      await verifySignature(
        keys.dskPublic,
        signature,
        serverAuthMessage("srv_2", "dev_1", "challenge"),
      ),
    ).toBe(false);
  });

  it("recognises sign-in links, pairing payloads and app links", () => {
    const token = "t".repeat(43);
    expect(
      parseLoginInput(`http://127.0.0.1:8081/login?token=${token}`),
    ).toEqual({
      kind: "token",
      url: "http://127.0.0.1:8081",
      token,
    });
    const payload =
      "oss-storage://pair?v=1&s=https%3A%2F%2Fhome.example.org%2F&c=CODE&n=home&fp=FP";
    const pairing = {
      kind: "pairing",
      url: "https://home.example.org",
      code: "CODE",
      name: "home",
      fp: "FP",
    };
    expect(parseLoginInput(payload)).toEqual(pairing);
    const app = `https://remote.example.org/#oss=${Buffer.from(payload).toString("base64url")}`;
    expect(parseLoginInput(app)).toEqual(pairing);
    expect(parseLoginInput("hello")).toBeNull();
    expect(parseLoginInput("https://example.org/")).toBeNull();
  });

  it("round-trips sessions and rejects damaged ones", () => {
    const s = {
      url: "https://h",
      serverId: "srv",
      deviceId: "dev",
      key: "k",
      fp: "f",
    };
    expect(decodeSession(encodeSession(s))).toEqual(s);
    expect(() => decodeSession("nope")).toThrow("not a session");
    expect(() => decodeSession("storage-session-v1.e30")).toThrow(
      "missing url",
    );
  });
});

describe("config store", () => {
  it("writes config.json with mode 0600 in a 0700 directory", () => {
    const dir = join(tmp(), "cfg");
    const store = new ConfigStore(dir);
    expect(store.read()).toEqual({ current: null, contexts: {} });
    store.update((c) => {
      c.contexts.home = {
        url: "http://x",
        createdAt: "",
        auth: { type: "token", token: "t" },
      };
      c.current = "home";
    });
    expect(store.read().current).toBe("home");
    if (process.platform !== "win32") {
      expect(statSync(store.file).mode & 0o777).toBe(0o600);
      expect(statSync(dir).mode & 0o777).toBe(0o700);
    }
  });

  it("names contexts from server names without clashes", () => {
    expect(contextName("My Home!", [])).toBe("my-home");
    expect(contextName("home", ["home", "home-2"])).toBe("home-3");
    expect(contextName("???", [])).toBe("server");
  });

  it("caches tokens until shortly before they expire", () => {
    let now = 1_000_000;
    const cache = new TokenCache(tmp(), () => now);
    cache.set("k", "tok", now + 600_000);
    expect(cache.get("k")).toBe("tok");
    now += 590_000;
    expect(cache.get("k")).toBeNull();
    cache.delete("k");
    expect(new TokenCache(join(tmp(), "a", "b")).get("x")).toBeNull();
  });
});

describe("console paths", () => {
  it("maps console paths onto both transports", () => {
    expect(consolePath("accounts")).toBe("/api/accounts");
    expect(consolePath("/api/logs?after=1")).toBe("/api/logs?after=1");
    expect(consolePath("metrics")).toBe("/metrics");
    const token = new ConsoleClient({
      source: "t",
      url: "http://127.0.0.1:8081",
      auth: { type: "token", token: "x" },
    });
    expect(token.urlFor("/api/logs?level=warn")).toBe(
      "http://127.0.0.1:8081/api/logs?level=warn",
    );
    const device = new ConsoleClient({
      source: "t",
      url: "https://home.example.org/",
      auth: { type: "device", serverId: "s", deviceId: "d", key: "k" },
    });
    expect(device.urlFor("/api/logs?level=warn")).toBe(
      "https://home.example.org/v1/console/logs?level=warn",
    );
    expect(device.urlFor("/api/metrics")).toBe(
      "https://home.example.org/v1/console/metrics",
    );
    expect(device.urlFor("/metrics")).toBe(
      "https://home.example.org/v1/console/prometheus",
    );
  });
});

describe("TLS key pinning", () => {
  it("talks to a self-signed server only when its key matches the pin", async () => {
    const key = generateP256();
    const cert = selfSigned(["127.0.0.1"], key, new Date());
    const server = createServer({ key: key.keyPem, cert }, (_req, res) =>
      res.end("hello"),
    );
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const url = `https://127.0.0.1:${(server.address() as AddressInfo).port}/`;
    try {
      const { createHash } = await import("node:crypto");
      const fp = createHash("sha256")
        .update(key.publicKey.export({ type: "spki", format: "der" }))
        .digest("base64url");
      const ok = await send({ method: "GET", url, fp });
      expect(ok.body.toString()).toBe("hello");
      await expect(
        send({ method: "GET", url, fp: "A".repeat(43) }),
      ).rejects.toMatchObject({
        code: "PIN_MISMATCH",
      });
      // Without a pin, the system CAs decide: a self-signed chain fails.
      await expect(send({ method: "GET", url })).rejects.toBeInstanceOf(
        NetworkError,
      );
    } finally {
      server.close();
    }
  });
});
