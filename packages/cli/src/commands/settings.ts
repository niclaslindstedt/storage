// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// `settings`: the console's Settings page — how long earlier versions of
// files and deleted files are kept (GET/PATCH /api/settings).

import type {
  RetentionKey,
  Settings,
} from "../../../server/src/admin/ui/types.ts";
import { UsageError } from "../args.ts";
import type { Cli } from "../cli.ts";
import { pairs } from "../output.ts";
import { EXIT } from "../spec.ts";

/** Flag / argument name ⇄ setting. */
const NAMES: Record<string, RetentionKey> = {
  "history-days": "historyDays",
  "history-versions": "historyCount",
  "trash-days": "trashDays",
};

const LABEL: Record<RetentionKey, (n: number) => string> = {
  historyDays: (n) =>
    n === 0 ? "keep no earlier versions" : `keep earlier versions ${n} days`,
  historyCount: (n) => `at most ${n} versions per file`,
  trashDays: (n) => `keep deleted files ${n} days`,
};

function print(cli: Cli, s: Settings): void {
  if (cli.bool("json")) {
    cli.out(JSON.stringify(s, null, 2));
    return;
  }
  cli.out(
    pairs(
      Object.entries(NAMES).map(([name, key]) => [
        name,
        `${s.retention[key]}  ${cli.style.dim(
          `${LABEL[key](s.retention[key])}${
            s.changed.includes(key)
              ? ` (set here; configuration: ${s.defaults[key]})`
              : " (from the configuration)"
          }`,
        )}`,
      ]),
      cli.style,
    ),
  );
}

export async function settings(cli: Cli, sub: string): Promise<number> {
  const client = cli.client();
  switch (sub) {
    case "show":
      print(cli, await client.get<Settings>("/api/settings"));
      return EXIT.ok;
    case "set": {
      const body: Partial<Record<RetentionKey, number>> = {};
      for (const [name, key] of Object.entries(NAMES)) {
        const v = cli.int(name, Number.NaN);
        if (!Number.isNaN(v)) body[key] = v;
      }
      if (Object.keys(body).length === 0)
        throw new UsageError(
          "give at least one of --history-days, --history-versions, --trash-days",
        );
      const s = await client.json<Settings>("PATCH", "/api/settings", body);
      if (!cli.bool("json")) cli.ok("Settings saved");
      print(cli, s);
      return EXIT.ok;
    }
    case "reset": {
      const body: Partial<Record<RetentionKey, null>> = {};
      for (const name of cli.args.positionals) {
        const key = NAMES[name];
        if (!key)
          throw new UsageError(
            `unknown setting ${name}: use ${Object.keys(NAMES).join(", ")}`,
          );
        body[key] = null;
      }
      const s = await client.json<Settings>("PATCH", "/api/settings", body);
      if (!cli.bool("json"))
        cli.ok("Back to the server configuration's values");
      print(cli, s);
      return EXIT.ok;
    }
  }
  return EXIT.usage;
}
