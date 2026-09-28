// The CLI against a real server over the console listener with the admin
// token: logging in, credentials from the environment and .env files, and
// every console page and action.

import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createNamespace } from "../../server/src/services/namespaces.ts";
import { principal, WRAP, envelopeB64u } from "../../server/tests/helpers.ts";
import { harness, json, shell } from "./helpers.ts";

describe("credentials", () => {
  it("is not logged in anywhere by default (exit 4)", async () => {
    const r = await shell()(["account", "ls"]);
    expect(r.code).toBe(4);
    expect(r.err).toContain("storage auth login");
  });

  it("logs in with the console's sign-in link and saves a private context", async () => {
    const h = await harness();
    const sh = shell();
    const login = await sh(["auth", "login", h.loginUrl]);
    expect(login.code, login.err).toBe(0);
    expect(login.err).toContain("context home");
    const file = join(sh.configDir, "config.json");
    const config = JSON.parse(readFileSync(file, "utf8"));
    expect(config.current).toBe("home");
    expect(config.contexts.home).toMatchObject({
      url: h.admin.url,
      server: "home",
      auth: { type: "token" },
    });
    if (process.platform !== "win32")
      expect(statSync(file).mode & 0o777).toBe(0o600);
    // Logging in again to the same console reuses the context.
    await sh(["auth", "login", h.loginUrl]);
    expect(
      Object.keys(JSON.parse(readFileSync(file, "utf8")).contexts),
    ).toEqual(["home"]);
    expect((await sh(["context", "ls", "-q"])).out).toBe("home");
    expect((await sh(["auth", "status"])).code).toBe(0);
    expect((await sh(["auth", "token"])).out).toBe(h.admin.auth.token());
  });

  it("logs in with --with-token and rejects a wrong token", async () => {
    const h = await harness();
    const sh = shell();
    const bad = await sh(
      ["auth", "login", "--with-token", "--url", h.admin.url],
      { stdin: "x".repeat(43) },
    );
    expect(bad.code).toBe(4);
    expect(bad.err).toContain("admin token was rejected");
    const good = await sh(
      ["auth", "login", "--with-token", "--url", h.admin.url, "-c", "box"],
      {
        stdin: `${h.admin.auth.token()}\n`,
      },
    );
    expect(good.code, good.err).toBe(0);
    expect((await sh(["context", "show"])).out).toBe("box");
  });

  it("takes STORAGE_URL + STORAGE_TOKEN from the environment, a .env file or a _FILE", async () => {
    const h = await harness();
    const token = h.admin.auth.token();
    const sh = shell();
    const env = await sh(["account", "ls", "--json"], {
      env: { STORAGE_URL: h.admin.url, STORAGE_TOKEN: token },
    });
    expect(env.code, env.err).toBe(0);
    expect(json(env)).toEqual([]);

    writeFileSync(
      join(sh.home, ".env"),
      `# admin\nSTORAGE_URL=${h.admin.url}\nSTORAGE_TOKEN="${token}"\n`,
    );
    expect((await sh(["account", "ls"])).code).toBe(0);
    // The process environment wins over the file.
    const wins = await sh(["account", "ls"], {
      env: { STORAGE_TOKEN: "y".repeat(43) },
    });
    expect(wins.code).toBe(4);

    writeFileSync(join(sh.home, "secret"), token);
    writeFileSync(
      join(sh.home, "ci.env"),
      `STORAGE_URL=${h.admin.url}\nSTORAGE_TOKEN_FILE=secret\n`,
    );
    expect((await sh(["--env-file", "ci.env", "account", "ls"])).code).toBe(0);
    expect(
      (await sh(["account", "ls", "--env-file", "missing.env"])).code,
    ).toBe(2);
  });

  it("on the server's machine, reads admin.token from the data directory", async () => {
    const h = await harness();
    const sh = shell();
    const dataDir = join(sh.home, "data");
    const { mkdirSync } = await import("node:fs");
    mkdirSync(dataDir);
    writeFileSync(join(dataDir, "admin.token"), `${h.admin.auth.token()}\n`);
    const port = new URL(h.admin.url).port;
    const r = await sh(["auth", "status", "--json"], {
      env: { STORAGE_DATA_DIR: dataDir, STORAGE_ADMIN_PORT: port },
    });
    expect(r.code, r.err).toBe(0);
    expect(json(r)[0]).toMatchObject({
      source: `admin.token in ${dataDir}`,
      ok: true,
      auth: "token",
    });
  });

  it("never sends a saved context's credentials to another STORAGE_URL", async () => {
    const h = await harness();
    const sh = shell();
    await sh(["auth", "login", h.loginUrl]);
    const r = await sh(["account", "ls"], {
      env: { STORAGE_URL: "http://127.0.0.1:1" },
    });
    expect(r.code).toBe(4);
    expect(r.err).toContain("not logged in to http://127.0.0.1:1");
  });

  it("manages contexts like docker contexts", async () => {
    const h = await harness();
    const sh = shell();
    await sh(["auth", "login", h.loginUrl, "-c", "one"]);
    await sh(
      ["auth", "login", "--with-token", "--url", h.admin.url, "-c", "two"],
      { stdin: h.admin.auth.token() },
    );
    expect((await sh(["context", "show"])).out).toBe("two");
    expect((await sh(["context", "use", "one"])).code).toBe(0);
    expect((await sh(["context", "rename", "one", "uno"])).code).toBe(0);
    expect((await sh(["context", "show"])).out).toBe("uno");
    expect((await sh(["-c", "two", "context", "show"])).out).toBe("two");
    expect((await sh(["context", "use", "nope"])).code).toBe(2);
    expect((await sh(["context", "rm", "two"])).code).toBe(0);
    expect(
      json(await sh(["context", "ls", "--json"])).map(
        (c: { name: string }) => c.name,
      ),
    ).toEqual(["uno"]);
    expect((await sh(["auth", "export"])).out).toBe(
      `STORAGE_URL=${h.admin.url}\nSTORAGE_TOKEN=${h.admin.auth.token()}`,
    );
    expect((await sh(["auth", "logout"])).code).toBe(0);
    expect((await sh(["account", "ls"])).code).toBe(4);
  });
});

describe("the console's pages", () => {
  async function loggedIn() {
    const h = await harness();
    const sh = shell();
    const r = await sh(["auth", "login", h.loginUrl]);
    expect(r.code, r.err).toBe(0);
    return { h, sh };
  }

  it("Accounts: create, list, view, edit, pair and delete", async () => {
    const { h, sh } = await loggedIn();
    expect(
      (await sh(["account", "create", "niclas", "--role", "admin"])).code,
    ).toBe(0);
    const kid = await sh([
      "account",
      "create",
      "kid",
      "--quota",
      "1G",
      "--json",
    ]);
    expect(json(kid)).toMatchObject({
      name: "kid",
      role: "member",
      quotaBytes: 1024 ** 3,
    });
    expect((await sh(["account", "create", "kid"])).code).toBe(1);

    expect((await sh(["account", "ls", "-q"])).out.split("\n").sort()).toEqual([
      "kid",
      "niclas",
    ]);
    expect(
      (
        await sh([
          "account",
          "ls",
          "--role",
          "admin",
          "--format",
          "{{.name}}:{{.role}}",
        ])
      ).out,
    ).toBe("niclas:admin");
    const rows = (await sh(["accounts", "list"])).out.split("\n");
    expect(rows.find((l) => l.startsWith("kid\t"))).toContain("1.0 GiB (0%)");

    const edited = await sh([
      "account",
      "edit",
      "kid",
      "--name",
      "teen",
      "--unlimited",
      "--disable",
      "--json",
    ]);
    expect(json(edited)).toMatchObject({
      name: "teen",
      quotaBytes: null,
      disabled: true,
    });
    expect((await sh(["account", "edit", "teen"])).code).toBe(2);
    expect(
      (await sh(["account", "edit", "teen", "--enable", "--disable"])).code,
    ).toBe(2);

    const view = json(await sh(["account", "view", "niclas", "--json"]));
    expect(view.account.name).toBe("niclas");
    expect(view.devices).toEqual([]);

    const pair = await sh(["account", "pair", "teen", "--no-qr"]);
    expect(pair.out).toMatch(/^oss-storage:\/\/pair\?v=1&s=/);
    const fresh = json(
      await sh([
        "account",
        "pair",
        "--new",
        "grandma",
        "--role",
        "guest",
        "--json",
      ]),
    );
    expect(fresh.payload).toMatch(/^oss-storage:/);
    expect(fresh.svg).toMatch(/^<svg/);
    expect((await sh(["account", "pair", "teen", "--admin-app"])).code).toBe(2);
    const admin = await sh(["account", "pair", "niclas", "--admin-app"]);
    expect(admin.code, admin.err).toBe(0);

    // Deleting asks for the name; without a terminal it needs --yes.
    expect((await sh(["account", "rm", "teen"])).code).toBe(2);
    expect(
      (await sh(["account", "rm", "teen"], { answers: ["kid"] })).code,
    ).toBe(1);
    expect(
      (await sh(["account", "rm", "teen"], { answers: ["teen"] })).code,
    ).toBe(0);
    // The server keeps its last admin.
    const rm = await sh(["account", "rm", "niclas", "-y"]);
    expect(rm.code).toBe(1);
    expect(rm.err).toContain("at least one active admin");
    expect((await sh(["account", "ls", "-q"])).out).toBe("niclas");
    expect(h.app.ctx.audit.verify().ok).toBe(true);
  });

  it("Devices: list, view, revoke and remove admin access", async () => {
    const { h, sh } = await loggedIn();
    const alice = principal(h.app.ctx, "alice");
    const bob = principal(h.app.ctx, "bob");
    const ls = await sh(["device", "ls", "--json"]);
    expect(
      json(ls)
        .map((d: { account: string }) => d.account)
        .sort(),
    ).toEqual(["alice", "bob"]);
    expect((await sh(["device", "ls", "--account", "alice", "-q"])).out).toBe(
      alice.deviceId,
    );
    expect(
      json(await sh(["device", "view", alice.deviceId.slice(0, 10), "--json"])),
    ).toMatchObject({ name: "alice-device" });
    expect((await sh(["device", "view", "dev_"])).code).toBe(2);

    expect((await sh(["device", "revoke", alice.deviceId])).code).toBe(2);
    expect(
      (await sh(["device", "revoke", alice.deviceId], { answers: ["n"] })).code,
    ).toBe(1);
    const revoked = await sh([
      "device",
      "revoke",
      alice.deviceId,
      bob.deviceId,
      "--yes",
    ]);
    expect(revoked.code, revoked.err).toBe(0);
    expect((await sh(["device", "ls", "-q"])).out).toBe("");
    expect(
      (await sh(["device", "ls", "--all", "-q"])).out.split("\n"),
    ).toHaveLength(2);
    expect(
      (await sh(["device", "ls", "--state", "revoked", "-q"])).out.split("\n"),
    ).toHaveLength(2);
    expect(
      (await sh(["device", "remove-admin", alice.deviceId, "-y"])).code,
    ).toBe(2);
  });

  it("Agents: pair an agent device and narrow its scope", async () => {
    const { h, sh } = await loggedIn();
    expect((await sh(["account", "create", "niclas"])).code).toBe(0);
    const pair = json(
      await sh([
        "account",
        "pair",
        "niclas",
        "--agent",
        "--perms",
        "data:read,data:write",
        "--apps",
        "drive",
        "--json",
      ]),
    );
    expect(pair.payload, "see stderr").toMatch(/^oss-storage:\/\/pair/);
    const stored = h.app.ctx.db.get<{ scope: string }>(
      "SELECT scope FROM pairings ORDER BY created_at DESC LIMIT 1",
    );
    expect(JSON.parse(stored!.scope)).toEqual({
      perms: ["data:read", "data:write"],
      apps: ["drive"],
    });
    expect(
      (await sh(["account", "pair", "niclas", "--perms", "data:read"])).code,
    ).toBe(2);
    expect((await sh(["account", "pair", "--new", "x", "--agent"])).code).toBe(
      2,
    );

    // Narrow an ordinary device into an agent, then further; never wider.
    const carol = principal(h.app.ctx, "carol");
    const narrowed = await sh([
      "device",
      "scope",
      carol.deviceId,
      "--perms",
      "data:read,data:write",
      "--apps",
      "drive",
      "-y",
    ]);
    expect(narrowed.code, narrowed.err).toBe(0);
    expect((await sh(["device", "ls", "--agent", "-q"])).out).toBe(
      carol.deviceId,
    );
    const again = await sh([
      "device",
      "scope",
      carol.deviceId,
      "--perms",
      "data:read",
      "-y",
    ]);
    expect(again.code, again.err).toBe(0);
    expect(
      json(await sh(["device", "view", carol.deviceId, "--json"])).agent,
    ).toEqual({
      perms: ["data:read"],
      apps: ["drive"],
    });
    const wider = await sh([
      "device",
      "scope",
      carol.deviceId,
      "--perms",
      "sharing",
      "-y",
    ]);
    expect(wider.code).toBe(1);
    expect(wider.err).toMatch(/only be narrowed/);
    expect((await sh(["device", "scope", carol.deviceId, "-y"])).code).toBe(2);
  });

  it("Namespaces: metadata only", async () => {
    const { h, sh } = await loggedIn();
    const alice = principal(h.app.ctx, "alice");
    const ns = createNamespace(h.app.ctx, alice, {
      app: "meds",
      meta: envelopeB64u(),
      wrap: WRAP,
    });
    createNamespace(h.app.ctx, alice, {
      app: "notes",
      meta: envelopeB64u(),
      wrap: WRAP,
    });
    expect((await sh(["namespace", "ls", "--app", "meds", "-q"])).out).toBe(
      ns.id,
    );
    expect((await sh(["ns", "ls", "--owner", "bob", "-q"])).out).toBe("");
    const view = json(await sh(["namespace", "view", ns.id, "--json"]));
    expect(view).toMatchObject({
      app: "meds",
      owner: "alice",
      members: [{ name: "alice", role: "owner" }],
    });
  });

  it("Overview, Traffic, metrics and Troubleshoot", async () => {
    const { sh } = await loggedIn();
    // No admin account yet: the health verdict fails, and so does the exit code.
    const status = await sh(["status"]);
    expect(status.code).toBe(1);
    expect(status.out).toContain("An admin account exists");
    await sh(["account", "create", "niclas", "--role", "admin"]);
    const o = json(await sh(["status", "--json"]));
    expect(o.server.name).toBe("home");
    expect(o.counts.admins).toBe(1);

    const doctor = await sh(["doctor", "--json"]);
    expect(doctor.code).toBe(0);
    expect(json(doctor).results.some((c: { id: string }) => c.id)).toBe(true);
    expect((await sh(["doctor"])).out).toContain("Database integrity");

    const traffic = json(await sh(["traffic", "--json"]));
    expect(traffic).toHaveProperty("totals.since");
    expect((await sh(["traffic"])).out).toContain("Per minute");
    expect((await sh(["metrics"])).out).toContain("storage_accounts 1");

    const config = json(await sh(["system", "config", "--json"]));
    expect(config.name).toBe("home");
    expect((await sh(["system", "config"])).out).toMatch(/^name\s+home$/m);
    expect(json(await sh(["system", "housekeeping", "--json"]))).toHaveProperty(
      "trashPurged",
    );
    // An in-memory server with TLS and port mapping off refuses these.
    const backup = await sh(["system", "backup"]);
    expect(backup.code).toBe(1);
    expect(backup.err).toContain("nothing to back up");
    expect((await sh(["system", "renew-cert"])).err).toContain("acme");
    expect((await sh(["system", "refresh-ports"])).err).toContain("--upnp");

    const out = join(sh.home, "diag.json");
    expect((await sh(["system", "diagnostics", "-o", out])).code).toBe(0);
    expect(JSON.parse(readFileSync(out, "utf8"))).toHaveProperty(
      "overview.server.name",
      "home",
    );
    expect((await sh(["system", "diagnostics"])).code).toBe(0);
    expect(existsSync(sh.home)).toBe(true);
  });

  it("Settings: version history and trash", async () => {
    const { sh } = await loggedIn();
    const shown = await sh(["settings", "show"]);
    expect(shown.out).toMatch(
      /^history-days\s+30\s+keep earlier versions 30 days \(from the configuration\)$/m,
    );
    const set = await sh([
      "settings",
      "set",
      "--history-days",
      "90",
      "--trash-days",
      "7",
      "--json",
    ]);
    expect(set.code, set.err).toBe(0);
    expect(json(set).retention).toEqual({
      historyDays: 90,
      historyCount: 100,
      trashDays: 7,
    });
    expect((await sh(["settings", "show"])).out).toContain(
      "(set here; configuration: 30)",
    );
    const bad = await sh(["settings", "set", "--history-days", "-3"]);
    expect(bad.code).toBe(1);
    expect(bad.err).toContain("historyDays must be a whole number");
    expect((await sh(["settings", "set"])).code).toBe(2);
    expect((await sh(["settings", "reset", "retention"])).code).toBe(2);
    const reset = await sh(["settings", "reset", "history-days", "--json"]);
    expect(json(reset).retention.historyDays).toBe(30);
    expect(json(reset).changed).toEqual(["trashDays"]);
  });

  it("Logs and Audit", async () => {
    const { h, sh } = await loggedIn();
    h.app.ctx.log.warn("disk is getting full");
    h.app.ctx.log.info("an ordinary line");
    const warn = await sh(["logs", "--level", "warn"]);
    expect(warn.out).toContain("disk is getting full");
    expect(warn.out).not.toContain("an ordinary line");
    const grep = await sh(["logs", "--grep", "ORDINARY", "--json"]);
    expect(JSON.parse(grep.out.split("\n").at(-1)!)).toMatchObject({
      level: "info",
      message: "an ordinary line",
    });
    expect((await sh(["logs", "-n", "1"])).out.split("\n")).toHaveLength(1);
    // No debug log file on an in-memory server.
    expect((await sh(["logs", "download", "-o", "-"])).code).toBe(1);

    await sh(["account", "create", "kid"]);
    const audit = json(
      await sh(["audit", "ls", "--action", "account", "--json"]),
    );
    expect(audit[0]).toMatchObject({
      action: "account.create",
      actor: "admin-console",
    });
    expect(
      (await sh(["audit", "--format", "{{.action}}", "-n", "1"])).out,
    ).toBe("account.create");
    const verify = await sh(["audit", "verify"]);
    expect(verify.code).toBe(0);
    expect(verify.out).toContain("intact");
  });

  it("follows the log live until interrupted", async () => {
    const { h, sh } = await loggedIn();
    const stop = new AbortController();
    const seen: string[] = [];
    const run = sh(["logs", "-f", "-n", "0"], {
      signal: stop.signal,
      onOut: (l) => {
        seen.push(l);
        if (l.includes("second")) stop.abort();
      },
    });
    await new Promise((r) => setTimeout(r, 300));
    h.app.ctx.log.info("first live line");
    h.app.ctx.log.info("second live line");
    const r = await run;
    expect(seen.join("\n")).toMatch(/first live line[\s\S]*second live line/);
    expect(r.code).toBe(0);
  });

  it("api: any console endpoint, with fields", async () => {
    const { sh } = await loggedIn();
    const created = await sh([
      "api",
      "accounts",
      "-f",
      "name=kid",
      "-f",
      "role=guest",
      "-F",
      "quotaBytes=1024",
    ]);
    expect(created.code, created.err).toBe(0);
    expect(json(created)).toMatchObject({
      name: "kid",
      role: "guest",
      quotaBytes: 1024,
    });
    expect(json(await sh(["api", "/api/accounts"]))).toHaveLength(1);
    const bad = await sh(["api", "accounts", "-X", "POST", "-F", "role=boss"]);
    expect(bad.code).toBe(1);
    expect(bad.err).toContain("HTTP 400");
    expect((await sh(["api", "metrics"])).out).toContain("# TYPE");
    writeFileSync(join(sh.home, "body.json"), JSON.stringify({ name: "neo" }));
    expect((await sh(["api", "accounts", "--input", "body.json"])).code).toBe(
      0,
    );
  });
});

describe("usage", () => {
  it("prints help, commands and versions; rejects bad usage with exit 2", async () => {
    const sh = shell();
    expect((await sh([])).out).toContain("Administration:");
    expect((await sh(["account", "--help"])).out).toContain("Subcommands:");
    expect((await sh(["account", "ls", "--help"])).out).toContain("--role");
    expect((await sh(["help", "logs"])).out).toContain("docker logs -f");
    expect((await sh(["account"])).out).toContain("Subcommands:");
    expect((await sh(["commands"])).out.split("\n").length).toBeGreaterThan(10);
    expect((await sh(["commands", "device"])).out).toContain(
      "--state  type=string",
    );
    expect((await sh(["--help-agent"])).out).toContain("storage commands");
    expect((await sh(["--debug-agent"])).out).toContain("config.json");
    expect((await sh(["version"])).out).toMatch(/^\d+\.\d+\.\d+/);
    expect((await sh(["frobnicate"])).code).toBe(2);
    expect((await sh(["account", "ls", "--nope"])).code).toBe(2);
    expect((await sh(["account", "view"])).code).toBe(2);
    expect((await sh(["account", "view", "a", "b"])).code).toBe(2);
  });
});
