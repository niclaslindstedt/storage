// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Argument parsing against the flag specs in `spec.ts`: `--flag value`,
// `--flag=value`, `--flag` / `--no-flag` for booleans, repeatable lists.
// Unknown flags are a usage error, never silently ignored.

import type { FlagSpec } from "./spec.ts";

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

export type ParsedArgs = {
  positionals: string[];
  flags: Record<string, string | boolean | string[] | number>;
};

export function parseArgs(
  argv: readonly string[],
  specs: readonly FlagSpec[],
): ParsedArgs {
  const byName = new Map(specs.map((s) => [s.name, s]));
  const out: ParsedArgs = { positionals: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--") {
      out.positionals.push(...argv.slice(i + 1));
      break;
    }
    if (!arg.startsWith("--") || arg === "--") {
      out.positionals.push(arg);
      continue;
    }
    let name = arg.slice(2);
    let value: string | undefined;
    const eq = name.indexOf("=");
    if (eq >= 0) {
      value = name.slice(eq + 1);
      name = name.slice(0, eq);
    }
    let spec = byName.get(name);
    if (
      !spec &&
      name.startsWith("no-") &&
      byName.get(name.slice(3))?.type === "bool"
    ) {
      out.flags[name.slice(3)] = false;
      continue;
    }
    if (!spec) throw new UsageError(`unknown flag --${name}`);
    if (spec.type === "bool") {
      if (value !== undefined && !["true", "false", "1", "0"].includes(value)) {
        throw new UsageError(`--${name} takes no value`);
      }
      out.flags[name] =
        value === undefined || value === "true" || value === "1";
      continue;
    }
    if (value === undefined) {
      value = argv[++i];
      if (value === undefined) throw new UsageError(`--${name} needs a value`);
    }
    spec = spec!;
    if (spec.type === "int") {
      if (!/^-?\d+$/.test(value))
        throw new UsageError(`--${name} must be an integer`);
      out.flags[name] = Number(value);
    } else if (spec.type === "list") {
      const list = (out.flags[name] as string[] | undefined) ?? [];
      list.push(
        ...value
          .split(",")
          .map((v) => v.trim())
          .filter(Boolean),
      );
      out.flags[name] = list;
    } else {
      out.flags[name] = value;
    }
  }
  return out;
}
