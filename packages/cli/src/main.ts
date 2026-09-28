// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The `storage` CLI: environment and .env loading, global flags, help
// surfaces and command dispatch. `runCli` is pure of process globals so
// tests drive it in-process; `bin.ts` wires it to the real process.

import { VERSION } from "../../server/src/version.ts";
import { parseArgs, resolveInvocation, UsageError } from "./args.ts";
import { Cancelled, Cli, type CliDeps } from "./cli.ts";
import { ApiError, AuthError } from "./client.ts";
import { ConfigStore, defaultConfigDir } from "./config.ts";
import { account, device, namespace } from "./commands/admin.ts";
import {
  authExport,
  authLogin,
  authLogout,
  authStatus,
  authToken,
  context,
} from "./commands/auth.ts";
import {
  api,
  audit,
  doctor,
  logs,
  metrics,
  status,
  system,
  traffic,
} from "./commands/monitor.ts";
import { loadEnv } from "./env.ts";
import { NetworkError } from "./http.ts";
import {
  renderCommandHelp,
  renderCommandsList,
  renderCommandSpec,
  renderDebugAgent,
  renderExamples,
  renderHelpAgent,
  renderSubcommandHelp,
  renderTopHelp,
} from "./render.ts";
import { EXIT, findCommand, findSubcommand, GLOBAL_FLAGS } from "./spec.ts";

export type { CliDeps } from "./cli.ts";

export async function runCli(
  input: readonly string[],
  deps: CliDeps,
): Promise<number> {
  const out = deps.out;
  const debugAgent = input.includes("--debug-agent");
  const argv = input.filter((a) => a !== "--debug-agent");
  if (argv.includes("--help-agent")) {
    out(renderHelpAgent());
    return EXIT.ok;
  }
  if (argv[0] === "--version" || argv[0] === "-V") {
    out(VERSION);
    return EXIT.ok;
  }

  let inv;
  let args;
  try {
    inv = resolveInvocation(argv);
    const specs = [
      ...(inv.sub?.flags ?? inv.command?.flags ?? []),
      ...GLOBAL_FLAGS,
    ];
    args = parseArgs(
      [...inv.leading, ...inv.rest],
      specs.filter((f, i) => specs.findIndex((g) => g.name === f.name) === i),
    );
  } catch (err) {
    if (!(err instanceof UsageError)) throw err;
    deps.err(`error: ${err.message}\n\nRun 'storage --help' for usage.`);
    return EXIT.usage;
  }
  const { command, sub } = inv;

  let loaded: ReturnType<typeof loadEnv>;
  try {
    loaded = loadEnv(
      deps.env,
      args.flags["env-file"] as string[] | undefined,
      deps.cwd,
    );
  } catch (err) {
    deps.err(`error: ${(err as Error).message}`);
    return EXIT.usage;
  }
  const env = loaded.env;
  const truthy = (v: string | undefined) =>
    v !== undefined && v !== "" && v !== "0" && v !== "false";
  const color =
    deps.tty &&
    args.flags["no-color"] !== true &&
    !truthy(env.NO_COLOR) &&
    env.TERM !== "dumb";
  const debug = args.flags.debug === true || truthy(env.STORAGE_DEBUG);
  const store = new ConfigStore(defaultConfigDir(env, deps.platform));
  const cli = new Cli(deps, args, env, store, color, debug);

  if (debugAgent) {
    let target: string;
    try {
      const t = cli.target();
      target = `${t.source} → ${t.url} (${t.auth.type === "token" ? "admin token" : `admin device ${t.auth.deviceId}`})`;
    } catch (err) {
      target = (err as Error).message;
    }
    out(
      renderDebugAgent({
        configFile: store.file,
        envFiles: loaded.loaded,
        target,
      }),
    );
    return EXIT.ok;
  }
  if (!command) {
    out(renderTopHelp());
    return args.flags.help ? EXIT.ok : argv.length ? EXIT.usage : EXIT.ok;
  }
  if (args.flags.help) {
    out(
      sub && inv.named
        ? renderSubcommandHelp(command, sub)
        : renderCommandHelp(command),
    );
    return EXIT.ok;
  }
  if (command.subcommands && !sub) {
    out(renderCommandHelp(command));
    return EXIT.ok;
  }
  const [min, max] = sub?.args ?? command.args ?? [0, Infinity];
  const n = args.positionals.length;
  if (n < min || n > max) {
    const usage = sub?.usage ?? command.usage;
    deps.err(
      `error: ${n < min ? "missing argument" : `unexpected argument ${args.positionals[max]}`}\nusage: ${usage}`,
    );
    return EXIT.usage;
  }

  try {
    switch (command.name) {
      case "auth":
        switch (sub!.name) {
          case "login":
            return await authLogin(cli);
          case "logout":
            return await authLogout(cli);
          case "status":
            return await authStatus(cli);
          case "token":
            return await authToken(cli);
          case "export":
            return await authExport(cli);
        }
        break;
      case "context":
        return await context(cli, sub!.name);
      case "status":
        return await status(cli);
      case "account":
        return await account(cli, sub!.name);
      case "device":
        return await device(cli, sub!.name);
      case "namespace":
        return await namespace(cli, sub!.name);
      case "traffic":
        return await traffic(cli);
      case "metrics":
        return await metrics(cli);
      case "logs":
        return await logs(cli, sub!.name);
      case "audit":
        return await audit(cli, sub!.name);
      case "doctor":
        return await doctor(cli);
      case "system":
        return await system(cli, sub!.name);
      case "api":
        return await api(cli);
      case "commands": {
        const target = args.positionals[0];
        if (!target) {
          out(args.flags.examples ? renderExamples() : renderCommandsList());
          return EXIT.ok;
        }
        const c = findCommand(target);
        if (!c) throw new UsageError(`unknown command: ${target}`);
        out(args.flags.examples ? renderExamples(c) : renderCommandSpec(c));
        return EXIT.ok;
      }
      case "help": {
        const [name, subName] = args.positionals;
        if (!name) {
          out(renderTopHelp());
          return EXIT.ok;
        }
        const c = findCommand(name);
        if (!c) throw new UsageError(`unknown command: ${name}`);
        const s = subName ? findSubcommand(c, subName) : undefined;
        if (subName && !s)
          throw new UsageError(`unknown ${c.name} subcommand: ${subName}`);
        out(s ? renderSubcommandHelp(c, s) : renderCommandHelp(c));
        return EXIT.ok;
      }
      case "version":
        out(VERSION);
        return EXIT.ok;
    }
    return EXIT.usage;
  } catch (err) {
    return report(cli, err, sub?.usage ?? command.usage);
  }
}

function report(cli: Cli, err: unknown, usage: string): number {
  const s = cli.style;
  if (err instanceof UsageError) {
    cli.err(`${s.red("error:")} ${err.message}\nusage: ${usage}`);
    return EXIT.usage;
  }
  if (err instanceof Cancelled) {
    cli.err("cancelled");
    return EXIT.failure;
  }
  if (err instanceof AuthError) {
    cli.err(`${s.red("error:")} ${err.message}`);
    return EXIT.auth;
  }
  if (err instanceof ApiError || err instanceof NetworkError) {
    cli.err(`${s.red("error:")} ${err.message}`);
    return EXIT.failure;
  }
  if ((err as Error)?.name === "AbortError") return EXIT.failure;
  cli.err(`${s.red("error:")} ${(err as Error)?.message ?? String(err)}`);
  if (cli.debug && (err as Error)?.stack) cli.err(s.dim((err as Error).stack!));
  return EXIT.failure;
}
