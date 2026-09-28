// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// `accounts`, `devices`, `namespaces` and `audit`: local administration via
// direct access to the data directory (which is the admin credential).

import type { ServerConfig } from "../../config.ts";
import { ApiError } from "../../errors.ts";
import {
  type Account,
  createAccount,
  deleteAccount,
  findAccountByName,
  listAccounts,
  updateAccount,
} from "../../services/accounts.ts";
import { listDevices, revokeDevice } from "../../services/devices.ts";
import { UsageError, type ParsedArgs } from "../args.ts";
import { type CliIo, openContext } from "../io.ts";
import { EXIT } from "../spec.ts";

function table(rows: string[][]): string {
  const widths = rows[0]!.map((_, i) =>
    Math.max(...rows.map((r) => (r[i] ?? "").length)),
  );
  return rows
    .map((r) =>
      r
        .map((c, i) => c.padEnd(widths[i]!))
        .join("  ")
        .trimEnd(),
    )
    .join("\n");
}

const bytes = (n: number | null) =>
  n === null
    ? "unlimited"
    : n < 1024
      ? `${n} B`
      : n < 1024 ** 2
        ? `${(n / 1024).toFixed(1)} KiB`
        : n < 1024 ** 3
          ? `${(n / 1024 ** 2).toFixed(1)} MiB`
          : `${(n / 1024 ** 3).toFixed(2)} GiB`;

async function withCtx(
  io: CliIo,
  config: ServerConfig,
  fn: (ctx: ReturnType<typeof openContext>) => Promise<number> | number,
): Promise<number> {
  const ctx = openContext(config, io.log);
  try {
    return await fn(ctx);
  } catch (err) {
    if (err instanceof ApiError) {
      io.err(err.message);
      return EXIT.failure;
    }
    throw err;
  } finally {
    ctx.db.close();
  }
}

export function runAccounts(
  io: CliIo,
  config: ServerConfig,
  args: ParsedArgs,
): Promise<number> {
  const [sub, name] = args.positionals;
  const f = args.flags;
  return withCtx(io, config, async (ctx) => {
    const need = (): Account => {
      if (!name) throw new UsageError("account name is required");
      const acc = findAccountByName(ctx, name);
      if (!acc)
        throw new ApiError(404, "not_found", `no account named ${name}`);
      return acc;
    };
    switch (sub ?? "list") {
      case "list": {
        const list = listAccounts(ctx);
        if (f.json) io.out(JSON.stringify(list, null, 2));
        else
          io.out(
            table([
              ["NAME", "ROLE", "USED", "QUOTA", "STATE", "ID"],
              ...list.map((a) => [
                a.name,
                a.role,
                bytes(a.usedBytes),
                bytes(a.quotaBytes),
                a.disabled ? "disabled" : "active",
                a.id,
              ]),
            ]),
          );
        return EXIT.ok;
      }
      case "create": {
        if (!name) throw new UsageError("account name is required");
        const acc = createAccount(
          ctx,
          {
            name,
            role: (f.role as Account["role"]) ?? "member",
            quotaBytes: f.quota as number | undefined,
          },
          "cli",
        );
        io.log.status(
          `created ${acc.role} account ${acc.name} (${acc.id}); pair a device with: storage-server pair --account ${acc.name}`,
        );
        return EXIT.ok;
      }
      case "update": {
        const acc = need();
        if (f.disable && f.enable)
          throw new UsageError("--disable and --enable are exclusive");
        const updated = updateAccount(
          ctx,
          acc.id,
          {
            name: f.rename as string | undefined,
            role: f.role as Account["role"] | undefined,
            quotaBytes: f.unlimited ? null : (f.quota as number | undefined),
            disabled: f.disable ? true : f.enable ? false : undefined,
          },
          "cli",
        );
        io.log.status(
          `updated ${updated.name}: ${updated.role}, quota ${bytes(updated.quotaBytes)}${updated.disabled ? ", disabled" : ""}`,
        );
        return EXIT.ok;
      }
      case "delete": {
        const acc = need();
        if (f.yes !== true) {
          io.err(
            `this deletes ${acc.name} and every namespace it owns, for all members; re-run with --yes`,
          );
          return EXIT.failure;
        }
        await deleteAccount(ctx, acc.id, "cli");
        io.log.status(`deleted ${acc.name}`);
        return EXIT.ok;
      }
      default:
        throw new UsageError(`unknown subcommand accounts ${sub}`);
    }
  });
}

export function runDevices(
  io: CliIo,
  config: ServerConfig,
  args: ParsedArgs,
): Promise<number> {
  const [sub, id] = args.positionals;
  return withCtx(io, config, (ctx) => {
    switch (sub ?? "list") {
      case "list": {
        const accounts = listAccounts(ctx);
        const only = args.flags.account as string | undefined;
        const chosen = only
          ? accounts.filter((a) => a.name.toLowerCase() === only.toLowerCase())
          : accounts;
        if (only && chosen.length === 0)
          throw new ApiError(404, "not_found", `no account named ${only}`);
        const rows = chosen.flatMap((a) =>
          listDevices(ctx, a.id).map((d) => ({ account: a.name, ...d })),
        );
        if (args.flags.json) io.out(JSON.stringify(rows, null, 2));
        else
          io.out(
            table([
              [
                "ACCOUNT",
                "DEVICE",
                "PLATFORM",
                "KEY",
                "LAST SEEN",
                "STATE",
                "ID",
              ],
              ...rows.map((d) => [
                d.account,
                d.name,
                d.platform,
                d.hasAccountKey ? "yes" : "pending",
                d.lastSeenAt ? new Date(d.lastSeenAt).toISOString() : "never",
                d.revokedAt
                  ? "revoked"
                  : d.agent
                    ? `agent (${d.agent.perms.join(" ") || "-"})`
                    : "active",
                d.id,
              ]),
            ]),
          );
        return EXIT.ok;
      }
      case "revoke": {
        if (!id) throw new UsageError("device id is required");
        revokeDevice(ctx, null, id, null);
        io.log.status(`revoked ${id}`);
        return EXIT.ok;
      }
      default:
        throw new UsageError(`unknown subcommand devices ${sub}`);
    }
  });
}

export function runNamespaces(
  io: CliIo,
  config: ServerConfig,
  args: ParsedArgs,
): Promise<number> {
  const [sub] = args.positionals;
  if (sub && sub !== "list")
    throw new UsageError(`unknown subcommand namespaces ${sub}`);
  return withCtx(io, config, (ctx) => {
    const rows = ctx.db.all<{
      id: string;
      app: string;
      owner: string;
      members: number;
      used_bytes: number;
      seq: number;
      epoch: number;
    }>(
      `SELECT n.id, n.app, a.name AS owner, n.used_bytes, n.seq, n.epoch,
              (SELECT COUNT(*) FROM members m WHERE m.namespace_id = n.id) AS members
       FROM namespaces n JOIN accounts a ON a.id = n.owner_account_id ORDER BY a.name, n.app`,
    );
    if (args.flags.json) io.out(JSON.stringify(rows, null, 2));
    else
      io.out(
        table([
          ["APP", "OWNER", "MEMBERS", "USED", "SEQ", "EPOCH", "ID"],
          ...rows.map((r) => [
            r.app,
            r.owner,
            String(r.members),
            bytes(r.used_bytes),
            String(r.seq),
            String(r.epoch),
            r.id,
          ]),
        ]),
      );
    return EXIT.ok;
  });
}

export function runAudit(
  io: CliIo,
  config: ServerConfig,
  args: ParsedArgs,
): Promise<number> {
  const [sub] = args.positionals;
  return withCtx(io, config, (ctx) => {
    if ((sub ?? "verify") === "verify") {
      const r = ctx.audit.verify();
      if (r.ok) {
        io.log.status(
          `audit chain intact: ${r.count} entries, head ${ctx.audit.head().slice(0, 16)}…`,
        );
        return EXIT.ok;
      }
      io.log.error(
        `audit chain BROKEN at entry ${r.brokenAt} (after ${r.count} good entries)`,
      );
      return EXIT.failure;
    }
    if (sub === "tail") {
      const limit = (args.flags.limit as number | undefined) ?? 50;
      const total =
        ctx.db.get<{ n: number }>("SELECT MAX(id) AS n FROM audit")!.n ?? 0;
      const entries = ctx.audit.list(Math.max(0, total - limit), limit);
      if (args.flags.json) io.out(JSON.stringify(entries, null, 2));
      else
        io.out(
          entries
            .map(
              (e) =>
                `${new Date(e.at).toISOString()}  ${e.action.padEnd(18)} ${e.actor ?? "-"} → ${e.target ?? "-"}${e.ip ? ` from ${e.ip}` : ""}${e.detail ? ` ${e.detail}` : ""}`,
            )
            .join("\n"),
        );
      return EXIT.ok;
    }
    throw new UsageError(`unknown subcommand audit ${sub}`);
  });
}
