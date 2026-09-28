import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runCli } from "../src/cli/main.ts";
import { renderMan } from "../src/cli/render.ts";
import { COMMANDS, GLOBAL_FLAGS } from "../src/cli/spec.ts";
import { openDatabase } from "../src/db/database.ts";
import { createMemoryLogger } from "../src/log.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "cli-"));
  dirs.push(d);
  return d;
}

async function cli(
  argv: string[],
  env: Record<string, string> = {},
  signal = new AbortController().signal,
) {
  const out: string[] = [];
  const err: string[] = [];
  const log = createMemoryLogger();
  const code = await runCli(argv, {
    out: (t) => out.push(t),
    err: (t) => err.push(t),
    env: { HOME: "/home/test", ...env },
    signal,
    tty: false,
    log,
    // Default paths differ per OS; the expectations below are Linux's.
    platform: "linux",
  });
  return {
    code,
    out: out.join("\n"),
    err: err.join("\n"),
    log: log.lines.join("\n"),
  };
}

describe("discoverability (OSS_SPEC §12)", () => {
  it("--help-agent is deterministic and points at `commands`", async () => {
    const r = await cli(["--help-agent"]);
    expect(r.code).toBe(0);
    expect(r.out).not.toMatch(/\u001b\[/);
    expect(r.out).toContain("storage-server commands");
    for (const c of COMMANDS) expect(r.out).toContain(`  ${c.name}: `);
    expect(r.out).toMatchSnapshot();
  });

  it("--debug-agent lists logs, config precedence and every env var", async () => {
    const r = await cli(["--debug-agent"], {
      XDG_DATA_HOME: "/xdg/data",
      XDG_STATE_HOME: "/xdg/state",
    });
    expect(r.out).toContain("/xdg/state/storage-server/debug.log");
    expect(r.out).toContain("flags > environment > config.json > defaults");
    for (const f of GLOBAL_FLAGS.filter((x) => x.env))
      expect(r.out).toContain(f.env!);
    expect(r.out.replace(/node v[\d.]+ on \S+/, "node <v>")).toMatchSnapshot();
  });

  it("`commands` lists one command per line; details and examples per command", async () => {
    const list = await cli(["commands"]);
    expect(list.out.split("\n")).toHaveLength(COMMANDS.length);
    expect(list.out).toMatch(/^serve\s+storage-server serve/m);
    const pair = await cli(["commands", "pair"]);
    expect(pair.out).toContain("--account  type=string");
    expect(pair.out).toContain("exit-codes:");
    const ex = await cli(["commands", "upnp", "--examples"]);
    expect(ex.out).toContain("storage-server upnp status");
    expect(ex.out).not.toContain("# serve");
    const all = await cli(["commands", "--examples"]);
    for (const c of COMMANDS) expect(all.out).toContain(`# ${c.name}`);
  });

  it("every command has a committed, up-to-date manual page", async () => {
    for (const c of COMMANDS) {
      const file = join(__dirname, "..", "..", "..", "man", `${c.name}.md`);
      expect(existsSync(file), `man/${c.name}.md (run npm run gen:man)`).toBe(
        true,
      );
      expect(
        readFileSync(file, "utf8"),
        `man/${c.name}.md is stale (run npm run gen:man)`,
      ).toBe(renderMan(c));
      const documented = [
        ...readFileSync(file, "utf8").matchAll(/^\| `--([a-z-]+)`/gm),
      ].map((m) => m[1]);
      expect(new Set(documented)).toEqual(
        new Set([...c.flags, ...GLOBAL_FLAGS].map((f) => f.name)),
      );
    }
    expect((await cli(["man", "serve"])).out).toBe(renderMan(COMMANDS[0]!));
  });

  it("docs lists and prints embedded topics", async () => {
    const list = await cli(["docs"]);
    expect(list.out.split("\n")).toContain("home-hosting");
    const topic = await cli(["docs", "security"]);
    expect(topic.out).toContain("# Security model");
    expect((await cli(["docs", "nope"])).code).toBe(2);
  });

  it("rejects unknown commands and flags with exit code 2", async () => {
    expect((await cli(["frobnicate"])).code).toBe(2);
    const r = await cli(["accounts", "list", "--nope"]);
    expect(r.code).toBe(2);
    expect(r.err).toContain("unknown flag --nope");
  });
});

describe("administration", () => {
  it("accounts: create, list, update, delete", async () => {
    const dataDir = tmp();
    expect(
      (
        await cli([
          "accounts",
          "create",
          "alice",
          "--role",
          "admin",
          "--data-dir",
          dataDir,
        ])
      ).code,
    ).toBe(0);
    expect(
      (
        await cli([
          "accounts",
          "create",
          "bob",
          "--quota",
          "1000",
          "--data-dir",
          dataDir,
        ])
      ).code,
    ).toBe(0);
    const list = await cli([
      "accounts",
      "list",
      "--json",
      "--data-dir",
      dataDir,
    ]);
    const accounts = JSON.parse(list.out) as {
      name: string;
      quotaBytes: number | null;
    }[];
    expect(accounts.map((a) => a.name)).toEqual(["alice", "bob"]);
    expect(
      (
        await cli([
          "accounts",
          "update",
          "bob",
          "--unlimited",
          "--disable",
          "--data-dir",
          dataDir,
        ])
      ).code,
    ).toBe(0);
    const bob = (
      JSON.parse(
        (await cli(["accounts", "list", "--json", "--data-dir", dataDir])).out,
      ) as { name: string; disabled: boolean; quotaBytes: null }[]
    )[1]!;
    expect(bob).toMatchObject({ disabled: true, quotaBytes: null });
    expect(
      (await cli(["accounts", "delete", "bob", "--data-dir", dataDir])).code,
    ).toBe(1);
    expect(
      (await cli(["accounts", "delete", "bob", "--yes", "--data-dir", dataDir]))
        .code,
    ).toBe(0);
    expect(
      (
        await cli([
          "accounts",
          "delete",
          "alice",
          "--yes",
          "--data-dir",
          dataDir,
        ])
      ).code,
    ).toBe(1); // last admin
  });

  it("setup and pair print a QR code and payload", async () => {
    const dataDir = tmp();
    const setup = await cli([
      "setup",
      "--account",
      "root",
      "--public-url",
      "https://home.example",
      "--data-dir",
      dataDir,
    ]);
    expect(setup.code).toBe(0);
    expect(setup.out).toContain(
      "oss-storage://pair?v=1&s=https%3A%2F%2Fhome.example",
    );
    expect(setup.out).toContain("▀"); // half-block QR rows
    // setup refuses once the pairing created an admin? The admin exists only after redemption,
    // so create one directly and check the refusal.
    await cli([
      "accounts",
      "create",
      "root2",
      "--role",
      "admin",
      "--data-dir",
      dataDir,
    ]);
    expect((await cli(["setup", "--data-dir", dataDir])).code).toBe(1);
    const pair = await cli([
      "pair",
      "--account",
      "root2",
      "--json",
      "--data-dir",
      dataDir,
      "--app-url",
      "https://notes.example/app",
    ]);
    const parsed = JSON.parse(pair.out) as { uri: string; code: string };
    expect(parsed.uri.startsWith("https://notes.example/app#oss=")).toBe(true);
    expect(
      Buffer.from(parsed.uri.split("#oss=")[1]!, "base64url").toString(),
    ).toContain(parsed.code);
    expect(
      (await cli(["pair", "--account", "nobody", "--data-dir", dataDir])).code,
    ).toBe(1);
    expect((await cli(["pair", "--data-dir", dataDir])).code).toBe(2);
  });

  it("audit verify and tail; devices and namespaces list", async () => {
    const dataDir = tmp();
    await cli([
      "accounts",
      "create",
      "alice",
      "--role",
      "admin",
      "--data-dir",
      dataDir,
    ]);
    const v = await cli(["audit", "verify", "--data-dir", dataDir]);
    expect(v.code).toBe(0);
    expect(v.log).toContain("audit chain intact");
    const tail = await cli(["audit", "tail", "--json", "--data-dir", dataDir]);
    expect(JSON.parse(tail.out)[0].action).toBe("account.create");
    expect((await cli(["devices", "list", "--data-dir", dataDir])).code).toBe(
      0,
    );
    expect(
      (await cli(["namespaces", "list", "--data-dir", dataDir])).code,
    ).toBe(0);
  });

  it("backup writes a database that opens", async () => {
    const dataDir = tmp();
    await cli([
      "accounts",
      "create",
      "alice",
      "--role",
      "admin",
      "--data-dir",
      dataDir,
    ]);
    const out = join(tmp(), "b");
    expect(
      (await cli(["backup", "--out", out, "--data-dir", dataDir])).code,
    ).toBe(0);
    const db = openDatabase(join(out, "storage.db"));
    expect(db.get<{ n: number }>("SELECT COUNT(*) AS n FROM accounts")!.n).toBe(
      1,
    );
    db.close();
    expect(
      (await cli(["backup", "--out", out, "--data-dir", dataDir])).code,
    ).toBe(1); // not empty
  });

  it("admin prints a sign-in link, keeps the token, and rotates it", async () => {
    const dataDir = tmp();
    const first = await cli(["admin", "--data-dir", dataDir]);
    expect(first.code).toBe(0);
    const token = readFileSync(join(dataDir, "admin.token"), "utf8").trim();
    expect(first.out).toBe(`http://127.0.0.1:8081/login?token=${token}`);
    expect(first.log).not.toContain(token);
    expect((await cli(["admin", "--data-dir", dataDir])).out).toBe(first.out);

    const rotated = await cli([
      "admin",
      "--data-dir",
      dataDir,
      "--rotate",
      "--json",
      "--admin-port",
      "9001",
    ]);
    const j = JSON.parse(rotated.out) as { loginUrl: string; rotated: boolean };
    expect(j.rotated).toBe(true);
    expect(j.loginUrl).toMatch(/^http:\/\/127\.0\.0\.1:9001\/login\?token=/);
    expect(j.loginUrl).not.toContain(token);

    const exposed = await cli(["admin", "--data-dir", dataDir], {
      STORAGE_ADMIN_HOST: "0.0.0.0",
    });
    expect(exposed.out).toMatch(/^http:\/\/127\.0\.0\.1:8081/);
    expect(exposed.err).toMatch(/SSH tunnel/);
    expect(
      (await cli(["admin", "--data-dir", dataDir, "--admin-port", "-1"])).code,
    ).toBe(1);
  });

  it("serve without a terminal keeps the admin token out of its output", async () => {
    const dataDir = tmp();
    const stop = new AbortController();
    const run = cli(
      [
        "serve",
        "--data-dir",
        dataDir,
        "--tls",
        "off",
        "--host",
        "127.0.0.1",
        "--port",
        "0",
        "--admin-port",
        "0",
      ],
      {},
      stop.signal,
    );
    const token = () =>
      existsSync(join(dataDir, "admin.token"))
        ? readFileSync(join(dataDir, "admin.token"), "utf8").trim()
        : null;
    for (let i = 0; i < 100 && !token(); i++)
      await new Promise((r) => setTimeout(r, 20));
    await new Promise((r) => setTimeout(r, 100));
    stop.abort();
    const r = await run;
    expect(r.code).toBe(0);
    expect(r.log).toMatch(/run `storage-server admin` for the sign-in link/);
    for (const text of [r.out, r.err, r.log])
      expect(text).not.toContain(token()!);
  });

  it("config precedence: flags > env > config.json", async () => {
    const { loadServerConfig } = await import("../src/cli/config-load.ts");
    const dataDir = tmp();
    const { writeFileSync } = await import("node:fs");
    writeFileSync(
      join(dataDir, "config.json"),
      JSON.stringify({
        name: "file",
        listen: { port: 1111 },
        tls: { mode: "acme" },
      }),
    );
    const c1 = loadServerConfig({ "data-dir": dataDir }, {});
    expect(c1).toMatchObject({
      name: "file",
      listen: { port: 1111 },
      tls: { mode: "acme" },
    });
    const c2 = loadServerConfig(
      { "data-dir": dataDir },
      { STORAGE_NAME: "env", STORAGE_DOMAINS: "a.example, b.example" },
    );
    expect(c2.name).toBe("env");
    expect(c2.tls.domains).toEqual(["a.example", "b.example"]);
    const c3 = loadServerConfig(
      { "data-dir": dataDir, name: "flag", tls: "off" },
      { STORAGE_NAME: "env" },
    );
    expect(c3).toMatchObject({
      name: "flag",
      tls: { mode: "off" },
      listen: { host: "127.0.0.1" },
    });

    const c4 = loadServerConfig(
      { "data-dir": dataDir, "history-days": 90 },
      { STORAGE_TRASH_DAYS: "7", STORAGE_HISTORY_VERSIONS: "5" },
    );
    expect(c4.retention).toMatchObject({
      historyDays: 90,
      historyCount: 5,
      trashDays: 7,
    });
    expect(() =>
      loadServerConfig({ "data-dir": dataDir, "history-days": -1 }, {}),
    ).toThrow(/--history-days must be a whole number from 0 to 3650/);
    expect(() =>
      loadServerConfig(
        { "data-dir": dataDir },
        { STORAGE_HISTORY_VERSIONS: "0" },
      ),
    ).toThrow(/--history-versions/);
  });

  it("test-server prints its URL and secret and serves until aborted", async () => {
    const ac = new AbortController();
    const out: string[] = [];
    const running = runCli(["test-server", "--secret", "s3cret"], {
      out: (t) => out.push(t),
      err: () => {},
      env: {},
      signal: ac.signal,
      tty: false,
      log: createMemoryLogger(),
    });
    while (out.length === 0) await new Promise((r) => setTimeout(r, 10));
    const { url, secret } = JSON.parse(out[0]!);
    expect(secret).toBe("s3cret");
    const res = await fetch(`${url}/__test/accounts`, {
      method: "POST",
      headers: { "X-Test-Secret": secret, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "alice" }),
    });
    expect(res.status).toBe(201);
    ac.abort();
    expect(await running).toBe(0);
  });
});
