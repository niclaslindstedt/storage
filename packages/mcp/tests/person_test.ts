// What only a person does, at a terminal (`storage-mcp device approve|add`,
// `recovery-key`, `invite`): each hands out a key or a credential, so each
// needs an interactive terminal, the device's permission, and the person's
// own answers — the safety code above all.

import { afterEach, describe, expect, it } from "vitest";

import {
  createMemoryKeyVault,
  createSelfHostedClient,
} from "@niclaslindstedt/oss-framework/storage/selfhosted";

import { pairingUri } from "../../server/src/payload.ts";
import { createPairing } from "../../server/src/services/pairing.ts";
import { main } from "../src/cli.ts";
import type { Terminal } from "../src/person.ts";
import { agent, closeAll, drive, home, type Home } from "./helpers.ts";

afterEach(closeAll);

/** A scripted terminal: `answers` are what the person types, in order. */
function terminal(answers: string[], interactive = true) {
  const out: string[] = [];
  const err: string[] = [];
  const asked: string[] = [];
  const t: Terminal = {
    interactive,
    ansi: false,
    out: (l) => void out.push(l),
    err: (l) => void err.push(l),
    ask: async (q) => {
      asked.push(q);
      return answers.shift() ?? "";
    },
  };
  return { t, out, err, asked };
}

async function setup(perms: string[]) {
  const h = await home();
  const a = await agent(h, { perms });
  const home_ = a.dir.slice(0, a.dir.lastIndexOf("/"));
  const run = (argv: string[], term: ReturnType<typeof terminal>) =>
    main([...argv, "--home", home_], {}, term.t);
  return { h, a, run };
}

/** A new device of the account, waiting for the key. */
async function laptop(h: Home) {
  const code = createPairing(
    h.app.ctx,
    { accountId: h.account.id },
    "cli",
  ).code!;
  const c = createSelfHostedClient({
    vault: createMemoryKeyVault(),
    app: "drive",
  });
  await c.pair(pairingUri({ server: h.url, code }), { name: "laptop" });
  return c;
}

describe("person-only commands", () => {
  it("refuse to run without an interactive terminal", async () => {
    const { run } = await setup(["devices", "sharing", "data:read"]);
    for (const argv of [
      ["device", "approve"],
      ["device", "add"],
      ["recovery-key"],
      ["invite"],
    ]) {
      const term = terminal(["y"], false);
      expect(await run(argv, term)).toBe(1);
      expect(term.err.join("\n")).toMatch(/interactive terminal, for a person/);
      expect(term.out).toEqual([]);
    }
  });

  it("need the device's permission, enforced like the server does", async () => {
    const { run } = await setup(["data:read"]);
    const term = terminal(["y"]);
    expect(await run(["recovery-key"], term)).toBe(1);
    expect(term.err.join("\n")).toMatch(/no devices permission/);
    const inv = terminal(["y"]);
    expect(await run(["invite"], inv)).toBe(1);
    expect(inv.err.join("\n")).toMatch(/no sharing permission/);
  });

  it("device approve: the person types the code the new device shows", async () => {
    const { h, run } = await setup(["devices", "data:read"]);
    const lap = await laptop(h);
    const wrong = terminal(["11111 22222 33333 44444 55555"]);
    expect(await run(["device", "approve"], wrong)).toBe(1);
    expect(wrong.err.join("\n")).toMatch(/do not match.*NOT approved/s);
    expect(await lap.refreshKeys()).toBe("needs-keys");
    const right = terminal([await lap.safetyCode()]);
    expect(await run(["device", "approve"], right)).toBe(0);
    expect(right.asked[0]).toMatch(/Type the safety code "laptop" shows/);
    expect(await lap.refreshKeys()).toBe("ready");
    const none = terminal([]);
    expect(await run(["device", "approve"], none)).toBe(0);
    expect(none.err.join("\n")).toMatch(/No device is waiting/);
  });

  it("device add: a QR code with the account key, after a yes", async () => {
    const { run } = await setup(["devices", "data:read"]);
    expect(await run(["device", "add"], terminal(["n"]))).toBe(1);
    const term = terminal(["y"]);
    expect(await run(["device", "add", "--ttl", "5"], term)).toBe(0);
    const payload = term.out.find((l) => l.startsWith("oss-storage://pair"))!;
    const tablet = createSelfHostedClient({
      vault: createMemoryKeyVault(),
      app: "drive",
    });
    expect(await tablet.pair(payload, { name: "tablet" })).toBe("ready");
  });

  it("recovery-key: a new key, shown once to the person", async () => {
    const { h, run } = await setup(["devices", "data:read"]);
    const term = terminal(["yes"]);
    expect(await run(["recovery-key"], term)).toBe(0);
    const key = term.out.at(-1)!;
    expect(key).toMatch(/^[0-9A-Z]{4}(-[0-9A-Z]{1,4})+$/);
    expect(key).not.toBe(h.recoveryKey);
  });

  it("invite: picks an owned folder, confirms, prints the invite", async () => {
    const { h, run } = await setup(["sharing", "data:read"]);
    const a = await drive(h.phone, "Alpha", {});
    await drive(h.phone, "Beta", {});
    const term = terminal(["1", "y"]);
    expect(await run(["invite", "--role", "editor"], term)).toBe(0);
    expect(term.err.join("\n")).toMatch(/1\. Alpha/);
    const payload = term.out.find((l) => l.startsWith("oss-storage://invite"))!;
    expect(payload).toContain("r=editor");
    const direct = terminal(["y"]);
    expect(await run(["invite", a.id], direct)).toBe(0);
    expect((await (await h.phone.namespace(a.id)).invites()).length).toBe(2);
    expect(await run(["invite", "--role", "owner"], terminal(["y"]))).toBe(1);
  });
});
