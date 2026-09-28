// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// What only a person does, at a terminal: approving a device (the person
// compares safety codes), adding a device by QR (the code carries the
// account key), a new recovery key, and an invite (it carries a folder's
// key). Each hands out a key or a credential, so none of them is an MCP
// tool: the model never starts one, never sees what it prints, and never
// types the safety code.
//
// They refuse to run unless stdin and stdout are a terminal. That keeps an
// agent with a shell (whose commands run without one) from running them and
// reading the secret they print. It is a speed bump, not the boundary: the
// device's server-enforced scope is — they need the `devices` or `sharing`
// permission like the equivalent tools would.

import { encodeQr } from "../../server/src/qr/encode.ts";
import { qrToTerminal } from "../../server/src/qr/render.ts";
import type { McpConfig } from "./config.ts";
import { openSession, type Permission, type Session } from "./session.ts";
import { cleanName } from "./text.ts";

export type Terminal = {
  /** stdin and stdout are both a terminal (a person is there). */
  interactive: boolean;
  /** ANSI colours are fine (for the QR code). */
  ansi: boolean;
  out(line: string): void;
  err(line: string): void;
  /** Ask the person a question; resolves with the line they type. */
  ask(question: string): Promise<string>;
};

export class PersonOnlyError extends Error {}

export const PERSON_COMMANDS = [
  "device approve",
  "device add",
  "recovery-key",
  "invite",
] as const;

const digits = (code: string) => code.replace(/\D/g, "");

function requirePerson(term: Terminal, what: string): void {
  if (!term.interactive)
    throw new PersonOnlyError(
      `\`storage-mcp ${what}\` hands out keys or credentials, so it runs only at an interactive terminal, for a person — never for an agent or in a pipe`,
    );
}

function requirePerm(session: Session, perm: Permission, what: string): void {
  const scope = session.me.agent;
  if (scope && !scope.perms.includes(perm))
    throw new PersonOnlyError(
      `this agent device's scope has no ${perm} permission, so it cannot ${what}: do it in Storage Remote, or pair an agent with --perms …,${perm}`,
    );
  if (!session.ready)
    throw new PersonOnlyError(
      "this device has no account key yet: approve it first (`storage-mcp pair`), or use `storage-mcp pair --recover`",
    );
}

async function yes(term: Terminal, question: string): Promise<boolean> {
  return /^y(es)?$/i.test((await term.ask(`${question} [y/N] `)).trim());
}

/** Pick one of `items` by number (or the only one). */
async function choose<T>(
  term: Terminal,
  items: T[],
  label: (t: T) => string,
  what: string,
): Promise<T> {
  if (items.length === 1) return items[0]!;
  items.forEach((t, i) => term.err(`  ${i + 1}. ${label(t)}`));
  const n = Number((await term.ask(`Which ${what}? `)).trim());
  if (!Number.isInteger(n) || n < 1 || n > items.length)
    throw new PersonOnlyError("no such choice; nothing was done");
  return items[n - 1]!;
}

function showQr(term: Terminal, payload: string, expiresAt: number): void {
  term.out(qrToTerminal(encodeQr(payload), { ansi: term.ansi }));
  term.out(payload);
  term.err(`Single use; expires ${new Date(expiresAt).toISOString()}.`);
}

export async function runPerson(
  cmd: string,
  args: { pos: string[]; flags: Record<string, string | boolean> },
  dir: string,
  config: McpConfig,
  env: NodeJS.ProcessEnv,
  term: Terminal,
): Promise<number> {
  const what = cmd === "device" ? `device ${args.pos[0] ?? ""}`.trim() : cmd;
  if (
    !(PERSON_COMMANDS as readonly string[]).includes(what) ||
    (cmd === "device" && args.pos.length > 2)
  )
    throw new PersonOnlyError(
      `unknown command ${what} (person commands: ${PERSON_COMMANDS.join(", ")})`,
    );
  requirePerson(term, what);
  const session = await openSession(dir, config, env);
  const { client } = session;

  switch (what) {
    case "device approve": {
      requirePerm(session, "devices", "approve devices");
      const waiting = await client.pendingDevices();
      const wanted = args.pos[1];
      const list = wanted ? waiting.filter((d) => d.id === wanted) : waiting;
      if (list.length === 0) {
        term.err(
          wanted
            ? `No device ${wanted} is waiting.`
            : "No device is waiting for the account key.",
        );
        return wanted ? 1 : 0;
      }
      const d = await choose(
        term,
        list,
        (x) => `${cleanName(x.name)} (${cleanName(x.platform)}, ${x.id})`,
        "device",
      );
      term.err(
        `Approving gives "${cleanName(d.name)}" your account key: everything this account can read. Do it only if you just paired that device yourself.`,
      );
      const typed = await term.ask(
        `Type the safety code "${cleanName(d.name, 60)}" shows (25 digits): `,
      );
      // Computed here from the keys the account key will be sealed to —
      // never the server's copy of the code.
      if (digits(typed) !== digits(d.safetyCode)) {
        term.err(
          "The safety codes do not match. The device was NOT approved. If you did not just pair it, someone else is trying to join your account: revoke it (`storage device revoke`, or Storage Remote).",
        );
        return 1;
      }
      await client.approveDevice(d.id);
      term.err(`${cleanName(d.name)} can now open this account's data.`);
      return 0;
    }
    case "device add": {
      requirePerm(session, "devices", "add devices");
      const ttl = Number(args.flags.ttl ?? 10);
      if (!Number.isInteger(ttl) || ttl < 1 || ttl > 60)
        throw new PersonOnlyError("--ttl is 1-60 minutes");
      if (
        !(await yes(
          term,
          "Make a one-time code that adds a device to this account with the account key sealed inside?",
        ))
      )
        return 1;
      const out = await client.addDevicePayload({ ttlSeconds: ttl * 60 });
      term.err("Scan it with the new device's app:");
      showQr(term, out.payload, out.expiresAt);
      return 0;
    }
    case "recovery-key": {
      requirePerm(session, "devices", "replace the recovery key");
      if (
        !(await yes(
          term,
          "Make a new recovery key? The old one stops working at once.",
        ))
      )
        return 1;
      const key = await client.regenerateRecoveryKey();
      term.err(
        "Your new recovery key — the only way back if every device is lost. Store it in a password manager or on paper; it is not shown again:",
      );
      term.out(key);
      return 0;
    }
    case "invite": {
      requirePerm(session, "sharing", "create invites");
      const role = String(args.flags.role ?? "viewer");
      if (role !== "viewer" && role !== "editor")
        throw new PersonOnlyError("--role is viewer or editor");
      const hours = Number(args.flags.hours ?? 168);
      const uses = Number(args.flags.uses ?? 1);
      if (!Number.isInteger(hours) || hours < 1 || hours > 720)
        throw new PersonOnlyError("--hours is 1-720");
      if (!Number.isInteger(uses) || uses < 1 || uses > 20)
        throw new PersonOnlyError("--uses is 1-20");
      const owned = (
        await client.namespaces(String(args.flags.app ?? "drive"))
      ).filter(
        (n) =>
          n.role === "owner" &&
          (!args.pos[0] || n.id === args.pos[0]) &&
          (!config.apps || config.apps.includes(n.app)) &&
          (!config.folders || config.folders.includes(n.id)),
      );
      if (owned.length === 0)
        throw new PersonOnlyError(
          args.pos[0]
            ? `you do not own ${args.pos[0]} (or it is not a ${String(args.flags.app ?? "drive")} namespace: pass --app)`
            : "you own no namespaces to share here",
        );
      const info = await choose(
        term,
        owned,
        (n) => `${cleanName(n.meta.name)} (${n.id})`,
        "folder",
      );
      if (
        !(await yes(
          term,
          `Invite ${uses} person(s) to ${role === "editor" ? "read and change" : "read"} everything in "${cleanName(info.meta.name)}"?`,
        ))
      )
        return 1;
      const ns = await client.namespace(info.id);
      const inv = await ns.invite({
        role,
        ttlSeconds: hours * 3600,
        maxUses: uses,
      });
      term.err(
        "Show this to the person you invite, or send the link over a channel you trust:",
      );
      showQr(term, inv.payload, inv.expiresAt);
      return 0;
    }
  }
  throw new PersonOnlyError(`unknown command ${what}`);
}

/** The real terminal of this process. */
export function processTerminal(): Terminal {
  const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  return {
    interactive,
    ansi: interactive && !process.env.NO_COLOR,
    out: (l) => void process.stdout.write(`${l}\n`),
    err: (l) => void process.stderr.write(`${l}\n`),
    ask: (question) =>
      new Promise((resolve) => {
        process.stderr.write(question);
        const onData = (chunk: Buffer) => {
          process.stdin.off("data", onData);
          process.stdin.pause();
          resolve(chunk.toString("utf8").split(/\r?\n/)[0] ?? "");
        };
        process.stdin.resume();
        process.stdin.on("data", onData);
      }),
  };
}
