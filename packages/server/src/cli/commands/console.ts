// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// `admin`: the admin console's sign-in link, and token rotation (SPEC §11.1).

import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { isLoopback } from "../../admin/checks.ts";
import { ensureAdminToken, rotateAdminToken } from "../../admin/session.ts";
import type { ServerConfig } from "../../config.ts";
import { UsageError, type ParsedArgs } from "../args.ts";
import type { CliIo } from "../io.ts";
import { EXIT } from "../spec.ts";

export function runAdmin(
  io: CliIo,
  config: ServerConfig,
  args: ParsedArgs,
): number {
  if (args.positionals.length > 0)
    throw new UsageError(`unexpected argument ${args.positionals[0]}`);
  const dir = config.dataDir!;
  const port = config.listen.adminPort;
  if (port === null) {
    io.err("the admin console is disabled (--admin-port -1)");
    return EXIT.failure;
  }
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const token = args.flags.rotate
    ? rotateAdminToken(dir)
    : ensureAdminToken(dir);
  const host = config.listen.adminHost;
  const shown =
    host === "0.0.0.0" || host === "::"
      ? "127.0.0.1"
      : host.includes(":")
        ? `[${host}]`
        : host;
  const url = `http://${shown}:${port}`;
  const loginUrl = `${url}/login?token=${token}`;
  if (args.flags.json) {
    io.out(
      JSON.stringify(
        {
          url,
          loginUrl,
          tokenFile: join(dir, "admin.token"),
          rotated: Boolean(args.flags.rotate),
        },
        null,
        2,
      ),
    );
    return EXIT.ok;
  }
  if (args.flags.rotate)
    io.log.status("admin token rotated; every console session has ended");
  io.out(loginUrl);
  if (!isLoopback(host))
    io.err(
      `note: the console listens on ${host}; publish it only on the host's loopback or use an SSH tunnel (ssh -L ${port}:127.0.0.1:${port} <server>)`,
    );
  return EXIT.ok;
}
