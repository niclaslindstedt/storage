// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Argument parsing against the flag specs in `spec.ts`: `--flag value`,
// `--flag=value`, `-f value`, `-fvalue`, grouped short booleans (`-qy`),
// `--no-flag` for booleans and repeatable lists. Global flags may appear
// anywhere. Unknown flags are a usage error, never silently ignored.

import {
  type CommandSpec,
  findCommand,
  findSubcommand,
  type FlagSpec,
  GLOBAL_FLAGS,
  type SubcommandSpec,
} from "./spec.ts";

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

export type Flags = Record<string, string | boolean | string[] | number>;

export type ParsedArgs = { positionals: string[]; flags: Flags };

export function parseArgs(
  argv: readonly string[],
  specs: readonly FlagSpec[],
): ParsedArgs {
  const byName = new Map(specs.map((s) => [s.name, s]));
  const byShort = new Map(
    specs.filter((s) => s.short).map((s) => [s.short!, s]),
  );
  const out: ParsedArgs = { positionals: [], flags: {} };

  const set = (spec: FlagSpec, label: string, value: string | undefined) => {
    if (spec.type === "bool") {
      if (value !== undefined && !["true", "false", "1", "0"].includes(value))
        throw new UsageError(`${label} takes no value`);
      out.flags[spec.name] =
        value === undefined || value === "true" || value === "1";
      return;
    }
    if (value === undefined) throw new UsageError(`${label} needs a value`);
    if (spec.type === "int") {
      if (!/^-?\d+$/.test(value))
        throw new UsageError(`${label} must be an integer`);
      out.flags[spec.name] = Number(value);
    } else if (spec.type === "list") {
      const list = (out.flags[spec.name] as string[] | undefined) ?? [];
      list.push(value);
      out.flags[spec.name] = list;
    } else {
      out.flags[spec.name] = value;
    }
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--") {
      out.positionals.push(...argv.slice(i + 1));
      break;
    }
    if (arg.startsWith("--")) {
      let name = arg.slice(2);
      let value: string | undefined;
      const eq = name.indexOf("=");
      if (eq >= 0) {
        value = name.slice(eq + 1);
        name = name.slice(0, eq);
      }
      const spec = byName.get(name);
      if (!spec) {
        const negated = byName.get(name.slice(3));
        if (name.startsWith("no-") && negated?.type === "bool") {
          if (value !== undefined)
            throw new UsageError(`--${name} takes no value`);
          out.flags[negated.name] = false;
          continue;
        }
        throw new UsageError(`unknown flag --${name}`);
      }
      if (spec.type !== "bool" && value === undefined) value = argv[++i];
      set(spec, `--${name}`, value);
      continue;
    }
    if (arg.startsWith("-") && arg.length > 1 && !/^-\d/.test(arg)) {
      // -x, -xVALUE, -x VALUE, or grouped booleans -qy.
      for (let j = 1; j < arg.length; j++) {
        const spec = byShort.get(arg[j]!);
        if (!spec) throw new UsageError(`unknown flag -${arg[j]}`);
        if (spec.type === "bool") {
          set(spec, `-${arg[j]}`, undefined);
          continue;
        }
        const rest = arg.slice(j + 1);
        set(spec, `-${arg[j]}`, rest !== "" ? rest : argv[++i]);
        break;
      }
      continue;
    }
    out.positionals.push(arg);
  }
  return out;
}

export type Invocation = {
  command: CommandSpec | undefined;
  sub: SubcommandSpec | undefined;
  /** Whether the subcommand was named (not the command's default). */
  named: boolean;
  /** The arguments after the command (and subcommand) names. */
  rest: string[];
  /** Global flags seen before the command name. */
  leading: string[];
};

const takesValue = (arg: string): boolean => {
  const name = arg.startsWith("--") ? arg.slice(2) : null;
  const spec = name
    ? GLOBAL_FLAGS.find((f) => f.name === name)
    : GLOBAL_FLAGS.find((f) => f.short && arg === `-${f.short}`);
  return spec !== undefined && spec.type !== "bool";
};

/** Find the command and subcommand names, skipping leading global flags. */
export function resolveInvocation(argv: readonly string[]): Invocation {
  const leading: string[] = [];
  let i = 0;
  while (i < argv.length && argv[i]!.startsWith("-") && argv[i] !== "-") {
    leading.push(argv[i]!);
    if (!argv[i]!.includes("=") && takesValue(argv[i]!)) {
      if (argv[i + 1] !== undefined) leading.push(argv[i + 1]!);
      i++;
    }
    i++;
  }
  const name = argv[i];
  if (name === undefined)
    return {
      command: undefined,
      sub: undefined,
      named: false,
      rest: [],
      leading,
    };
  const command = findCommand(name);
  if (!command) throw new UsageError(`unknown command: ${name}`);
  let rest = argv.slice(i + 1);
  let sub: SubcommandSpec | undefined;
  let named = false;
  if (command.subcommands) {
    const candidate = rest[0];
    if (candidate !== undefined && !candidate.startsWith("-")) {
      sub = findSubcommand(command, candidate);
      if (sub) {
        rest = rest.slice(1);
        named = true;
      } else if (!command.defaultSubcommand)
        throw new UsageError(
          `unknown ${command.name} subcommand: ${candidate} (try \`storage ${command.name} --help\`)`,
        );
    }
    if (!sub && command.defaultSubcommand)
      sub = findSubcommand(command, command.defaultSubcommand);
  }
  return { command, sub, named, rest: [...rest], leading };
}
