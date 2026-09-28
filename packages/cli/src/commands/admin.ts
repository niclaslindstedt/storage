// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// `account`, `device` and `namespace`: the console's Accounts, Devices and
// Namespaces pages. Everything shown is what the server already sees —
// names, roles, sizes, counts, times — never content or namespace names.

import { encodeQr } from "../../../server/src/qr/encode.ts";
import { qrToTerminal } from "../../../server/src/qr/render.ts";
import type {
  Account,
  Device,
  Namespace,
  Pairing,
} from "../../../server/src/admin/ui/types.ts";
import { UsageError } from "../args.ts";
import type { Cli } from "../cli.ts";
import { bytes, pairs, parseSize, when } from "../output.ts";
import { EXIT } from "../spec.ts";

const ROLES = ["admin", "member", "guest"] as const;

function role(cli: Cli, flag = "role"): Account["role"] | undefined {
  const r = cli.str(flag);
  if (r === undefined) return undefined;
  if (!(ROLES as readonly string[]).includes(r))
    throw new UsageError(`--${flag} must be admin, member or guest`);
  return r as Account["role"];
}

function size(cli: Cli, flag: string): number | undefined {
  const v = cli.str(flag);
  if (v === undefined) return undefined;
  try {
    return parseSize(v);
  } catch (err) {
    throw new UsageError(`--${flag}: ${(err as Error).message}`);
  }
}

async function findAccount(cli: Cli, ref: string): Promise<Account> {
  const accounts = await cli.client().get<Account[]>("/api/accounts");
  const found =
    accounts.find((a) => a.id === ref) ??
    accounts.find((a) => a.name.toLowerCase() === ref.toLowerCase());
  if (!found)
    throw new UsageError(
      `no account named ${ref} (see \`storage account ls\`)`,
    );
  return found;
}

const quota = (a: Account) =>
  a.quotaBytes === null
    ? "unlimited"
    : `${bytes(a.quotaBytes)} (${Math.round((a.usedBytes / Math.max(1, a.quotaBytes)) * 100)}%)`;

const accountState = (cli: Cli, a: Account) =>
  a.disabled
    ? cli.style.red("disabled")
    : a.hasKeys
      ? "active"
      : cli.style.yellow("no keys yet");

function printPairing(cli: Cli, p: Pairing, heading: string): void {
  if (cli.bool("json")) return cli.out(JSON.stringify(p, null, 2));
  if (cli.tty && !cli.bool("no-qr")) {
    cli.err(heading);
    cli.out(qrToTerminal(encodeQr(p.payload), { ansi: cli.color }));
  }
  cli.out(p.payload);
  cli.err(
    cli.style.dim(
      `Single use; expires ${cli.tty ? `${when(p.expiresAt, true, cli.now())} (${new Date(p.expiresAt).toISOString()})` : new Date(p.expiresAt).toISOString()}.\nIt signs the device in only — encryption keys never pass through the server.`,
    ),
  );
}

// ---------------------------------------------------------------- accounts

export async function account(cli: Cli, sub: string): Promise<number> {
  const client = cli.client();
  const s = cli.style;
  switch (sub) {
    case "ls": {
      const r = role(cli);
      const all = await client.get<Account[]>("/api/accounts");
      const rows = r ? all.filter((a) => a.role === r) : all;
      cli.printList(
        rows,
        [
          { header: "name", value: (a) => a.name },
          { header: "role", value: (a) => a.role },
          { header: "used", value: (a) => bytes(a.usedBytes) },
          { header: "quota", value: quota },
          { header: "devices", value: (a) => String(a.devices) },
          { header: "namespaces", value: (a) => String(a.namespaces) },
          {
            header: "last seen",
            value: (a) => when(a.lastSeenAt, cli.tty, cli.now()),
          },
          { header: "state", value: (a) => accountState(cli, a) },
        ],
        {
          key: (a) => a.name,
          empty: "no accounts yet: create one with `storage account create`",
        },
      );
      return EXIT.ok;
    }
    case "view": {
      const a = await findAccount(cli, cli.arg(0));
      const [devices, namespaces] = await Promise.all([
        client.get<Device[]>("/api/devices"),
        client.get<Namespace[]>("/api/namespaces"),
      ]);
      const own = devices.filter((d) => d.accountId === a.id);
      const owned = namespaces.filter((n) => n.owner === a.name);
      const shared = namespaces.filter(
        (n) => n.owner !== a.name && n.members.some((m) => m.name === a.name),
      );
      if (cli.bool("json")) {
        cli.out(
          JSON.stringify(
            { account: a, devices: own, namespaces: owned, sharedWith: shared },
            null,
            2,
          ),
        );
        return EXIT.ok;
      }
      cli.out(s.bold(a.name));
      cli.out(
        pairs(
          [
            ["id", a.id],
            ["role", a.role],
            ["state", accountState(cli, a)],
            ["used", bytes(a.usedBytes)],
            ["quota", quota(a)],
            ["created", when(a.createdAt, cli.tty, cli.now())],
            ["last seen", when(a.lastSeenAt, cli.tty, cli.now())],
          ],
          s,
        ),
      );
      cli.out(`\n${s.bold("Devices")}`);
      for (const d of own.filter((x) => x.state !== "revoked"))
        cli.out(
          `  ${d.id}  ${d.name}  ${s.dim(`${d.platform} · ${d.state}${d.console ? " · admin device" : ""} · seen ${when(d.lastSeenAt, cli.tty, cli.now())}`)}`,
        );
      if (!own.some((x) => x.state !== "revoked")) cli.out(s.dim("  none"));
      cli.out(`\n${s.bold("Namespaces")}`);
      for (const n of owned)
        cli.out(
          `  ${n.id}  ${n.app}  ${s.dim(`${bytes(n.usedBytes)} · ${n.members.length} member(s)`)}`,
        );
      for (const n of shared) {
        const r = n.members.find((m) => m.name === a.name)!.role;
        cli.out(`  ${n.id}  ${n.app}  ${s.dim(`shared by ${n.owner} · ${r}`)}`);
      }
      if (!owned.length && !shared.length) cli.out(s.dim("  none"));
      return EXIT.ok;
    }
    case "create": {
      const created = await client.json<Account>("POST", "/api/accounts", {
        name: cli.arg(0),
        role: role(cli) ?? "member",
        ...(cli.str("quota") !== undefined
          ? { quotaBytes: size(cli, "quota") }
          : {}),
      });
      if (!cli.bool("pair")) {
        if (cli.bool("json")) cli.out(JSON.stringify(created, null, 2));
        else
          cli.ok(
            `Created ${created.role} account ${s.bold(created.name)} (${created.id})`,
          );
        return EXIT.ok;
      }
      cli.ok(
        `Created ${created.role} account ${s.bold(created.name)} (${created.id})`,
      );
      const p = await client.json<Pairing>(
        "POST",
        `/api/accounts/${encodeURIComponent(created.id)}/pairing`,
        {},
      );
      printPairing(cli, p, `Scan with ${created.name}'s first device:`);
      return EXIT.ok;
    }
    case "edit": {
      const a = await findAccount(cli, cli.arg(0));
      if (cli.bool("disable") && cli.bool("enable"))
        throw new UsageError("--disable and --enable exclude each other");
      if (cli.str("quota") !== undefined && cli.bool("unlimited"))
        throw new UsageError("--quota and --unlimited exclude each other");
      const body: Record<string, unknown> = {};
      if (cli.str("name") !== undefined) body.name = cli.str("name");
      if (role(cli)) body.role = role(cli);
      if (cli.str("quota") !== undefined) body.quotaBytes = size(cli, "quota");
      if (cli.bool("unlimited")) body.quotaBytes = null;
      if (cli.bool("disable")) body.disabled = true;
      if (cli.bool("enable")) body.disabled = false;
      if (!Object.keys(body).length)
        throw new UsageError(
          "nothing to change: give --name, --role, --quota, --unlimited, --disable or --enable",
        );
      const updated = await client.json<Account>(
        "PATCH",
        `/api/accounts/${encodeURIComponent(a.id)}`,
        body,
      );
      if (cli.bool("json")) cli.out(JSON.stringify(updated, null, 2));
      else cli.ok(`Updated account ${s.bold(updated.name)}`);
      return EXIT.ok;
    }
    case "rm": {
      const a = await findAccount(cli, cli.arg(0));
      await cli.confirm(
        `Delete account ${a.name} and the ${a.namespaces} namespace(s) it owns, for every member? This cannot be undone.`,
        a.name,
      );
      await client.json("DELETE", `/api/accounts/${encodeURIComponent(a.id)}`, {
        confirm: a.name,
      });
      cli.ok(`Deleted account ${s.bold(a.name)}`);
      return EXIT.ok;
    }
    case "pair": {
      const fresh = cli.str("new");
      const ref = cli.args.positionals[0];
      if (Boolean(fresh) === Boolean(ref))
        throw new UsageError(
          "name an existing account, or give --new <name> to create one",
        );
      if (fresh) {
        if (cli.bool("admin-app"))
          throw new UsageError(
            "--admin-app pairs a device to an existing admin account",
          );
        const p = await client.json<Pairing>("POST", "/api/pairing", {
          name: fresh,
          role: role(cli) ?? "member",
        });
        printPairing(
          cli,
          p,
          `Scan with the device — redeeming it creates the ${role(cli) ?? "member"} account ${fresh}:`,
        );
        return EXIT.ok;
      }
      const a = await findAccount(cli, ref!);
      const adminApp = cli.bool("admin-app");
      if (adminApp && client.remote)
        throw new UsageError(
          "admin devices are paired at the machine only: log in with the admin token (on the server, or through an SSH tunnel), or run `storage-server pair --account <admin> --console` there",
        );
      if (adminApp && a.role !== "admin")
        throw new UsageError(
          `${a.name} is a ${a.role}: only an admin account can have admin devices`,
        );
      const p = await client.json<Pairing>(
        "POST",
        `/api/accounts/${encodeURIComponent(a.id)}/pairing`,
        adminApp ? { console: true } : {},
      );
      printPairing(
        cli,
        p,
        adminApp
          ? `Scan with Storage Remote (or pass to \`storage auth login\`) to pair an admin device for ${a.name}:`
          : `Scan with the device to pair it to ${a.name}:`,
      );
      return EXIT.ok;
    }
  }
  throw new Error(`unhandled account subcommand ${sub}`);
}

// ---------------------------------------------------------------- devices

function pick(devices: Device[], ref: string): Device {
  const exact = devices.find((d) => d.id === ref);
  if (exact) return exact;
  const matches = devices.filter((d) => d.id.startsWith(ref));
  if (matches.length === 1) return matches[0]!;
  if (matches.length > 1)
    throw new UsageError(
      `${ref} matches ${matches.length} devices: give more of the id`,
    );
  throw new UsageError(`no device ${ref} (see \`storage device ls\`)`);
}

export async function device(cli: Cli, sub: string): Promise<number> {
  const client = cli.client();
  const s = cli.style;
  const all = await client.get<Device[]>("/api/devices");
  switch (sub) {
    case "ls": {
      const state = cli.str("state");
      if (state && !["active", "pending", "revoked"].includes(state))
        throw new UsageError("--state must be active, pending or revoked");
      const acct = cli.str("account")?.toLowerCase();
      const rows = all.filter(
        (d) =>
          (state
            ? d.state === state
            : cli.bool("all") || d.state !== "revoked") &&
          (!acct ||
            d.account.toLowerCase() === acct ||
            d.accountId === cli.str("account")) &&
          (!cli.bool("admin") || d.console),
      );
      const stateLabel = (d: Device) =>
        d.state === "revoked"
          ? s.dim("revoked")
          : d.state === "pending"
            ? s.yellow("pending")
            : "active";
      cli.printList(
        rows,
        [
          { header: "id", value: (d) => d.id },
          { header: "name", value: (d) => d.name },
          { header: "account", value: (d) => d.account },
          { header: "platform", value: (d) => d.platform },
          { header: "state", value: stateLabel },
          { header: "admin", value: (d) => (d.console ? "yes" : "") },
          {
            header: "last seen",
            value: (d) => when(d.lastSeenAt, cli.tty, cli.now()),
          },
        ],
        { key: (d) => d.id, empty: "no devices" },
      );
      return EXIT.ok;
    }
    case "view": {
      const d = pick(all, cli.arg(0));
      if (cli.bool("json"))
        return (cli.out(JSON.stringify(d, null, 2)), EXIT.ok);
      cli.out(s.bold(d.name));
      cli.out(
        pairs(
          [
            ["id", d.id],
            ["account", `${d.account} (${d.accountId})`],
            ["platform", d.platform],
            ["state", d.state],
            [
              "admin device",
              d.console ? "yes — may use the console remotely" : "no",
            ],
            ["origin", d.origin ?? "—"],
            ["paired", when(d.createdAt, cli.tty, cli.now())],
            ["last seen", when(d.lastSeenAt, cli.tty, cli.now())],
            ...(d.revokedAt
              ? ([["revoked", when(d.revokedAt, cli.tty, cli.now())]] as [
                  string,
                  string,
                ][])
              : []),
          ],
          s,
        ),
      );
      return EXIT.ok;
    }
    case "revoke":
    case "remove-admin": {
      const targets = cli.args.positionals.map((ref) => pick(all, ref));
      const label = targets
        .map((d) => `${d.name} (${d.account}, ${d.id})`)
        .join(", ");
      if (sub === "revoke") {
        await cli.confirm(
          `Revoke ${label}? Its sessions end and its copy of the account key is deleted.`,
        );
        for (const d of targets) {
          await client.json(
            "DELETE",
            `/api/devices/${encodeURIComponent(d.id)}`,
          );
          cli.ok(`Revoked ${d.name} (${d.id})`);
        }
        if (cli.tty)
          cli.err(
            s.dim(
              "If a device was lost, rotate the keys of the namespaces it shared from an app.",
            ),
          );
      } else {
        for (const d of targets)
          if (!d.console)
            throw new UsageError(`${d.name} (${d.id}) is not an admin device`);
        await cli.confirm(
          `Take remote console access away from ${label}? It can only be granted again by pairing a new admin device.`,
        );
        for (const d of targets) {
          await client.json(
            "PATCH",
            `/api/devices/${encodeURIComponent(d.id)}`,
            { console: false },
          );
          cli.ok(`Removed admin access from ${d.name} (${d.id})`);
        }
      }
      return EXIT.ok;
    }
  }
  throw new Error(`unhandled device subcommand ${sub}`);
}

// ---------------------------------------------------------------- namespaces

export async function namespace(cli: Cli, sub: string): Promise<number> {
  const all = await cli.client().get<Namespace[]>("/api/namespaces");
  const s = cli.style;
  if (sub === "view") {
    const ref = cli.arg(0);
    const n =
      all.find((x) => x.id === ref) ??
      (() => {
        const m = all.filter((x) => x.id.startsWith(ref));
        if (m.length === 1) return m[0];
        throw new UsageError(
          m.length
            ? `${ref} matches ${m.length} namespaces`
            : `no namespace ${ref}`,
        );
      })()!;
    if (cli.bool("json")) return (cli.out(JSON.stringify(n, null, 2)), EXIT.ok);
    cli.out(
      `${s.bold(n.id)}  ${s.dim("(names and contents are end-to-end encrypted)")}`,
    );
    cli.out(
      pairs(
        [
          ["app", n.app],
          ["owner", n.owner],
          ["used", bytes(n.usedBytes)],
          ["change seq", String(n.seq)],
          ["key epoch", String(n.epoch)],
          ["pending invites", String(n.pendingInvites)],
          ["created", when(n.createdAt, cli.tty, cli.now())],
        ],
        s,
      ),
    );
    cli.out(`\n${s.bold("Members")}`);
    for (const m of n.members) cli.out(`  ${m.name}  ${s.dim(m.role)}`);
    return EXIT.ok;
  }
  const app = cli.str("app");
  const owner = cli.str("owner")?.toLowerCase();
  const rows = all.filter(
    (n) =>
      (!app || n.app === app) && (!owner || n.owner.toLowerCase() === owner),
  );
  cli.printList(
    rows,
    [
      { header: "id", value: (n) => n.id },
      { header: "app", value: (n) => n.app },
      { header: "owner", value: (n) => n.owner },
      {
        header: "members",
        value: (n) => n.members.map((m) => `${m.name}(${m.role})`).join(","),
      },
      { header: "used", value: (n) => bytes(n.usedBytes) },
      { header: "seq", value: (n) => String(n.seq) },
      { header: "epoch", value: (n) => String(n.epoch) },
      { header: "invites", value: (n) => String(n.pendingInvites) },
      {
        header: "created",
        value: (n) => when(n.createdAt, cli.tty, cli.now()),
      },
    ],
    { key: (n) => n.id, empty: "no namespaces" },
  );
  return EXIT.ok;
}
