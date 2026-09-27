// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// `setup` and `pair`: mint a one-time pairing code and show it as a QR code.

import type { ServerConfig } from "../../config.ts";
import { ApiError } from "../../errors.ts";
import { appLink, pairingUri } from "../../payload.ts";
import { encodeQr } from "../../qr/encode.ts";
import { qrToTerminal } from "../../qr/render.ts";
import { findAccountByName, listAccounts } from "../../services/accounts.ts";
import { createPairing, type PairingInput } from "../../services/pairing.ts";
import { UsageError, type ParsedArgs } from "../args.ts";
import { EXIT } from "../spec.ts";
import {
  advertisedUrl,
  type CliIo,
  openContext,
  selfSignedFingerprint,
} from "../io.ts";

export function printPairing(
  io: CliIo,
  config: ServerConfig,
  created: { code: string; expiresAt: number },
  opts: { qr: boolean; json: boolean; heading: string },
): void {
  const uri = pairingUri({
    server: advertisedUrl(config),
    code: created.code,
    name: config.name,
    fp: selfSignedFingerprint(config),
  });
  const payload = config.appUrl ? appLink(config.appUrl, uri) : uri;
  if (opts.json) {
    io.out(
      JSON.stringify({
        code: created.code,
        uri: payload,
        expiresAt: created.expiresAt,
      }),
    );
    return;
  }
  io.out(opts.heading);
  if (opts.qr) io.out(qrToTerminal(encodeQr(payload), { ansi: io.tty }));
  io.out(`\n${payload}\n`);
  io.out(`Single use; expires ${new Date(created.expiresAt).toISOString()}.`);
  io.out(
    "It signs the device in only — encryption keys never pass through the server.",
  );
}

export async function runPair(
  io: CliIo,
  config: ServerConfig,
  args: ParsedArgs,
  setup: boolean,
): Promise<number> {
  const ctx = openContext(config, io.log);
  try {
    let input: PairingInput;
    const ttl = args.flags.ttl as number | undefined;
    if (setup) {
      if (listAccounts(ctx).some((a) => a.role === "admin")) {
        io.err(
          "an admin account already exists; use `pair --account <name>` to add devices",
        );
        return EXIT.failure;
      }
      input = {
        newAccount: {
          name: (args.flags.account as string) ?? "admin",
          role: "admin",
        },
        ttlSeconds: ttl,
      };
    } else {
      const account = args.flags.account as string | undefined;
      const fresh = args.flags.new as string | undefined;
      if (Boolean(account) === Boolean(fresh))
        throw new UsageError("give exactly one of --account or --new");
      if (account) {
        const acc = findAccountByName(ctx, account);
        if (!acc) {
          io.err(`no account named ${account}`);
          return EXIT.failure;
        }
        input = { accountId: acc.id, ttlSeconds: ttl };
      } else {
        const role = (args.flags.role as string) ?? "member";
        if (!["admin", "member", "guest"].includes(role))
          throw new UsageError("--role must be admin, member or guest");
        input = {
          newAccount: {
            name: fresh!,
            role: role as "admin" | "member" | "guest",
          },
          ttlSeconds: ttl,
        };
      }
    }
    const created = createPairing(ctx, input, "cli");
    printPairing(
      io,
      config,
      { code: created.code!, expiresAt: created.expiresAt },
      {
        qr: args.flags["no-qr"] !== true,
        json: args.flags.json === true,
        heading: setup
          ? "Scan with the first device to create the admin account:"
          : "Scan with the device to pair:",
      },
    );
    return EXIT.ok;
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
