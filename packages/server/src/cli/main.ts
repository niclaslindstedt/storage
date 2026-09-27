// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The `storage-server` CLI: global flags, discoverability surfaces and
// command dispatch. `runCli` is pure of process globals so tests drive it
// in-process; `bin.ts` wires it to the real process.

import type { ServerConfig } from "../config.ts";
import { createLogger, type Logger } from "../log.ts";
import { VERSION } from "../version.ts";
import { parseArgs, UsageError } from "./args.ts";
import {
  runAccounts,
  runAudit,
  runDevices,
  runNamespaces,
} from "./commands/admin.ts";
import {
  runBackup,
  runCert,
  runDoctor,
  runHealth,
  runServe,
  runTestServer,
  runUpnp,
} from "./commands/ops.ts";
import { runAdmin } from "./commands/console.ts";
import { runPair } from "./commands/pairing.ts";
import { loadServerConfig } from "./config-load.ts";
import { DOC_TOPICS } from "./docs.ts";
import type { CliIo } from "./io.ts";
import { defaultDataDir, defaultLogFile } from "./paths.ts";
import {
  renderCommandHelp,
  renderCommandsList,
  renderCommandSpec,
  renderDebugAgent,
  renderExamples,
  renderHelpAgent,
  renderMan,
  renderTopHelp,
} from "./render.ts";
import { COMMANDS, EXIT, findCommand, GLOBAL_FLAGS } from "./spec.ts";

export type CliDeps = Omit<CliIo, "log"> & { log?: Logger };

export async function runCli(
  argv: readonly string[],
  deps: CliDeps,
): Promise<number> {
  const out = deps.out;
  if (argv.includes("--help-agent")) {
    out(renderHelpAgent());
    return EXIT.ok;
  }
  if (argv.includes("--debug-agent")) {
    const dataDir = defaultDataDir(deps.env, deps.platform);
    out(
      renderDebugAgent({
        dataDir,
        logFile: defaultLogFile(deps.env, deps.platform),
        configFile: `${dataDir}/config.json`,
      }),
    );
    return EXIT.ok;
  }
  if (argv[0] === "--version" || argv[0] === "-V") {
    out(VERSION);
    return EXIT.ok;
  }
  const first = argv[0];
  const isCommand = first !== undefined && !first.startsWith("-");
  const name = isCommand ? first : "serve";
  const rest = isCommand ? argv.slice(1) : argv;
  if (first === "--help" || first === "-h" || first === "help") {
    out(renderTopHelp());
    return EXIT.ok;
  }
  const spec = findCommand(name);
  if (!spec) {
    deps.err(`unknown command: ${name}\n\n${renderTopHelp()}`);
    return EXIT.usage;
  }

  let args;
  try {
    args = parseArgs(rest, [...spec.flags, ...GLOBAL_FLAGS]);
  } catch (err) {
    deps.err(`${(err as Error).message}\nusage: ${spec.usage}`);
    return EXIT.usage;
  }
  if (args.flags.help) {
    out(renderCommandHelp(spec));
    return EXIT.ok;
  }

  const debug =
    args.flags.debug === true ||
    ["1", "true"].includes(deps.env.STORAGE_DEBUG ?? "");
  const log =
    deps.log ??
    createLogger({
      file: defaultLogFile(deps.env, deps.platform),
      debug,
      // Diagnostics go to stderr; stdout carries the command's result.
      out: deps.err,
      err: deps.err,
      color: deps.tty,
    });
  const io: CliIo = {
    logFile: defaultLogFile(deps.env, deps.platform),
    ...deps,
    log,
  };

  try {
    const config = (): ServerConfig =>
      loadServerConfig(args.flags, deps.env, deps.platform);
    switch (spec.name) {
      case "serve":
        return await runServe(io, config());
      case "setup":
        return await runPair(io, config(), args, true);
      case "pair":
        return await runPair(io, config(), args, false);
      case "accounts":
        return await runAccounts(io, config(), args);
      case "devices":
        return await runDevices(io, config(), args);
      case "namespaces":
        return await runNamespaces(io, config(), args);
      case "audit":
        return await runAudit(io, config(), args);
      case "backup":
        return await runBackup(io, config(), args);
      case "cert":
        return await runCert(io, config(), args);
      case "upnp":
        return await runUpnp(io, config(), args);
      case "doctor":
        return await runDoctor(io, config());
      case "admin":
        return runAdmin(io, config(), args);
      case "health":
        return await runHealth(config());
      case "test-server":
        return await runTestServer(io, args);
      case "commands": {
        const target = args.positionals[0];
        if (target) {
          const c = findCommand(target);
          if (!c) throw new UsageError(`unknown command: ${target}`);
          out(args.flags.examples ? renderExamples(c) : renderCommandSpec(c));
        } else {
          out(args.flags.examples ? renderExamples() : renderCommandsList());
        }
        return EXIT.ok;
      }
      case "docs": {
        const topic = args.positionals[0];
        if (!topic) {
          out(Object.keys(DOC_TOPICS).join("\n"));
          return EXIT.ok;
        }
        const text = DOC_TOPICS[topic];
        if (!text)
          throw new UsageError(
            `no such topic: ${topic} (run \`storage-server docs\` to list them)`,
          );
        out(text);
        return EXIT.ok;
      }
      case "man": {
        const target = args.positionals[0];
        if (!target) {
          out(COMMANDS.map((c) => c.name).join("\n"));
          return EXIT.ok;
        }
        const c = findCommand(target);
        if (!c) throw new UsageError(`no manual page for ${target}`);
        out(renderMan(c));
        return EXIT.ok;
      }
    }
    return EXIT.usage;
  } catch (err) {
    if (err instanceof UsageError) {
      deps.err(`${err.message}\nusage: ${spec.usage}`);
      return EXIT.usage;
    }
    log.error(`${spec.name} failed`, err);
    return EXIT.failure;
  }
}
