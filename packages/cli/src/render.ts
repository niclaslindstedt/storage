// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Every help surface of the `storage` CLI, rendered from `spec.ts`: --help,
// `commands`, --help-agent, --debug-agent and the man/storage/*.md pages.
// Plain text, no ANSI.

import { VERSION } from "../../server/src/version.ts";
import {
  BIN,
  COMMANDS,
  type CommandSpec,
  ENV_VARS,
  type FlagSpec,
  GLOBAL_FLAGS,
  type SubcommandSpec,
} from "./spec.ts";

const flagLabel = (f: FlagSpec) =>
  `${f.short ? `-${f.short}, ` : "    "}--${f.name}${f.type === "bool" ? "" : ` ${f.value ?? `<${f.type}>`}`}${f.type === "list" ? "..." : ""}`;

const flagLine = (f: FlagSpec) =>
  `  ${flagLabel(f).padEnd(36)} ${f.description}${f.default ? ` [default: ${f.default}]` : ""}${f.env ? ` [env: ${f.env}]` : ""}`;

const GROUPS: [CommandSpec["group"], string][] = [
  ["core", "Core commands"],
  ["admin", "Administration"],
  ["monitor", "Monitoring and troubleshooting"],
  ["auth", "Servers and credentials"],
  ["meta", "Help"],
];

export function renderTopHelp(): string {
  const width = Math.max(...COMMANDS.map((c) => c.name.length));
  const lines = [
    `${BIN} ${VERSION} — administer a storage server from the terminal`,
    "",
    `Usage: ${BIN} <command> [<subcommand>] [flags]`,
  ];
  for (const [group, title] of GROUPS) {
    lines.push("", `${title}:`);
    for (const c of COMMANDS.filter((x) => x.group === group))
      lines.push(`  ${c.name.padEnd(width)}  ${c.summary}`);
  }
  lines.push(
    "",
    "Global flags:",
    ...GLOBAL_FLAGS.map(flagLine),
    "      --version                        Print the version.",
    "      --help-agent                     Prompt-ready description of this tool.",
    "      --debug-agent                    Prompt-ready troubleshooting context.",
    "",
    "Credentials: `storage auth login`, or STORAGE_TOKEN / STORAGE_SESSION in the",
    "environment or a .env file. On the server's machine it just works: the",
    "admin token is read from the data directory.",
    "",
    `Run '${BIN} <command> --help' for details.`,
  );
  return lines.join("\n");
}

function examplesBlock(c: CommandSpec): string[] {
  return c.examples.map((e) => `  ${e.cmd}${e.note ? `    # ${e.note}` : ""}`);
}

export function renderCommandHelp(c: CommandSpec): string {
  const lines = [c.summary, "", `Usage: ${c.usage}`];
  if (c.aliases?.length) lines.push(`Aliases: ${c.aliases.join(", ")}`);
  lines.push("", c.description);
  if (c.subcommands?.length) {
    const width = Math.max(...c.subcommands.map((s) => subName(s).length));
    lines.push(
      "",
      "Subcommands:",
      ...c.subcommands.map(
        (s) => `  ${subName(s).padEnd(width)}  ${s.summary}`,
      ),
    );
  }
  if (c.flags?.length) lines.push("", "Flags:", ...c.flags.map(flagLine));
  lines.push("", "Examples:", ...examplesBlock(c));
  if (c.subcommands?.length)
    lines.push("", `Run '${BIN} ${c.name} <subcommand> --help' for its flags.`);
  return lines.join("\n");
}

const subName = (s: SubcommandSpec) =>
  s.aliases?.length ? `${s.name} (${s.aliases.join(", ")})` : s.name;

export function renderSubcommandHelp(
  c: CommandSpec,
  s: SubcommandSpec,
): string {
  const lines = [s.summary, "", `Usage: ${s.usage}`];
  if (s.aliases?.length)
    lines.push(`Aliases: ${s.aliases.map((a) => `${c.name} ${a}`).join(", ")}`);
  if (s.flags.length) lines.push("", "Flags:", ...s.flags.map(flagLine));
  lines.push("", "Global flags:", ...GLOBAL_FLAGS.map(flagLine));
  const own = c.examples.filter((e) => e.cmd.includes(` ${c.name} ${s.name}`));
  if (own.length)
    lines.push(
      "",
      "Examples:",
      ...own.map((e) => `  ${e.cmd}${e.note ? `    # ${e.note}` : ""}`),
    );
  return lines.join("\n");
}

export function renderCommandsList(): string {
  const width = Math.max(...COMMANDS.map((c) => c.name.length));
  return COMMANDS.map((c) => `${c.name.padEnd(width)}  ${c.usage}`).join("\n");
}

export function renderCommandSpec(c: CommandSpec): string {
  const lines = [
    `name: ${c.name}`,
    `usage: ${c.usage}`,
    `summary: ${c.summary}`,
  ];
  if (c.aliases?.length) lines.push(`aliases: ${c.aliases.join(", ")}`);
  const flag = (f: FlagSpec) =>
    `    --${f.name}${f.short ? ` (-${f.short})` : ""}  type=${f.type}${f.default ? `  default=${f.default}` : ""}${f.env ? `  env=${f.env}` : ""}  ${f.description}`;
  if (c.subcommands?.length) {
    lines.push("subcommands:");
    for (const s of c.subcommands) {
      lines.push(`  ${s.name}: ${s.usage}`);
      for (const f of s.flags) lines.push(flag(f));
    }
  }
  if (c.flags?.length) lines.push("flags:", ...c.flags.map(flag));
  lines.push("global-flags:", ...GLOBAL_FLAGS.map(flag));
  lines.push(
    "exit-codes:",
    ...c.exitCodes.map((e) => `  ${e.code}  ${e.meaning}`),
  );
  return lines.join("\n");
}

export function renderExamples(c?: CommandSpec): string {
  return (c ? [c] : COMMANDS)
    .map((cmd) =>
      [
        `# ${cmd.name}`,
        ...cmd.examples.map(
          (e) => `${e.cmd}${e.note ? `    # ${e.note}` : ""}`,
        ),
      ].join("\n"),
    )
    .join("\n\n");
}

const flagRow = (f: FlagSpec) =>
  `| \`${f.short ? `-${f.short}, ` : ""}--${f.name}\` | ${f.type} | ${f.default ? `\`${f.default}\`` : "—"} | ${f.env ? `\`${f.env}\`` : "—"} | ${f.description} |`;
const FLAG_HEAD = [
  "| Flag | Type | Default | Environment | Description |",
  "|---|---|---|---|---|",
];

/** The manual page for a command, as committed under man/storage/<command>.md. */
export function renderMan(c: CommandSpec): string {
  const out = [
    `# ${BIN} ${c.name}`,
    "",
    c.summary,
    "",
    "## Synopsis",
    "",
    "```",
    c.usage,
    "```",
    "",
    "## Description",
    "",
    c.description,
  ];
  if (c.aliases?.length)
    out.push(
      "",
      `Aliases: ${c.aliases.map((a) => `\`${BIN} ${a}\``).join(", ")}.`,
    );
  if (c.subcommands?.length) {
    out.push("", "## Subcommands");
    for (const s of c.subcommands) {
      out.push("", `### ${s.name}`, "", s.summary, "", "```", s.usage, "```");
      if (s.aliases?.length)
        out.push(
          "",
          `Aliases: ${s.aliases.map((a) => `\`${a}\``).join(", ")}.`,
        );
      if (s.flags.length) out.push("", ...FLAG_HEAD, ...s.flags.map(flagRow));
    }
  }
  if (c.flags?.length)
    out.push("", "## Options", "", ...FLAG_HEAD, ...c.flags.map(flagRow));
  out.push(
    "",
    "## Global options",
    "",
    ...FLAG_HEAD,
    ...GLOBAL_FLAGS.map(flagRow),
  );
  out.push("", "## Exit codes", "", "| Code | Meaning |", "|---|---|");
  for (const e of c.exitCodes) out.push(`| ${e.code} | ${e.meaning} |`);
  out.push(
    "",
    "## Environment",
    "",
    "See [`storage`](README.md#environment) for every variable the CLI reads.",
  );
  out.push("", "## Examples", "");
  for (const e of c.examples)
    out.push("```sh", e.cmd, "```", ...(e.note ? ["", e.note, ""] : [""]));
  out.push(
    "## See also",
    "",
    c.seeAlso.map((s) => `[\`${BIN} ${s}\`](${s}.md)`).join(", "),
    "",
  );
  return out.join("\n");
}

/** man/storage/README.md: the command index and the environment. */
export function renderManIndex(): string {
  const out = [
    `# ${BIN}`,
    "",
    "Administer a storage server headlessly — the admin console's every page and action, from a terminal, a script or a container.",
    "Generated from `packages/cli/src/spec.ts` (`make man`); see [docs/cli.md](../../docs/cli.md) for the guide.",
    "",
    "## Commands",
    "",
    "| Command | Summary |",
    "|---|---|",
    ...COMMANDS.map(
      (c) => `| [\`${BIN} ${c.name}\`](${c.name}.md) | ${c.summary} |`,
    ),
    "",
    "## Environment",
    "",
    "The environment is read from the process and from `.env` files (`--env-file`, or `./.env` when present); the process environment wins.",
    "",
    "| Variable | Description |",
    "|---|---|",
    ...ENV_VARS.map(
      (e) => `| \`${e.name}\` | ${e.description.replace(/\|/g, "\\|")} |`,
    ),
    "",
  ];
  return out.join("\n");
}

export function renderHelpAgent(): string {
  return [
    `${BIN} ${VERSION}: a headless admin CLI for storage-server, the self-hosted zero-knowledge storage server for local-first apps.`,
    "It drives the admin console's JSON API: over the console listener (default http://127.0.0.1:8081) with the admin token,",
    "or over the server's HTTPS API at /v1/console as an admin device paired with `storage-server pair --account <admin> --console`.",
    "It sees what the console sees — names, roles, sizes, counts, times — never content (everything is end-to-end encrypted).",
    "",
    "Commands:",
    ...COMMANDS.map((c) => `  ${c.name}: ${c.summary}`),
    "",
    "Credentials (first match wins): -c <context>, STORAGE_SESSION, STORAGE_TOKEN (+ STORAGE_URL), STORAGE_CONTEXT,",
    "the saved context matching STORAGE_URL, the current context, then admin.token in the local server's data directory.",
    "Variables may come from .env (or --env-file); the process environment wins.",
    "",
    "For scripts: every list takes --json, -q (ids only) or --format '{{.field}}'; piped tables are tab-separated without",
    "headers; destructive commands need --yes without a terminal; exit 4 means not logged in or rejected.",
    "",
    "Discover more:",
    `  ${BIN} commands                # every command, one per line`,
    `  ${BIN} commands account        # subcommands, flags and exit codes of one command`,
    `  ${BIN} commands --examples     # example invocations`,
    `  ${BIN} api <path>              # any console endpoint (see docs/admin-console.md)`,
    `  ${BIN} --debug-agent           # troubleshooting context`,
  ].join("\n");
}

export function renderDebugAgent(info: {
  configFile: string;
  envFiles: string[];
  target: string;
}): string {
  return [
    `${BIN} ${VERSION} troubleshooting context`,
    `node ${process.version} on ${process.platform}/${process.arch}`,
    "",
    `config file (saved contexts, mode 0600): ${info.configFile}`,
    `env files loaded: ${info.envFiles.length ? info.envFiles.join(", ") : "none"}`,
    `credentials in use: ${info.target}`,
    "",
    "Environment variables:",
    ...ENV_VARS.map((e) => `  ${e.name}: ${e.description}`),
    "",
    "Common failures:",
    "  ECONNREFUSED on 127.0.0.1:8081   -> the console listens on the server's loopback: run there, tunnel (ssh -L 8081:127.0.0.1:8081 <server>), or log in as an admin device",
    "  421 misdirected                  -> the console answers only IP literals or localhost in the URL (DNS-rebinding guard)",
    "  admin token rejected             -> it was rotated (`storage-server admin --rotate`): log in again",
    "  admin device rejected            -> revoked, access removed, or its account demoted/disabled: pair a new one",
    "  self-signed certificate errors   -> pin the key: --fingerprint / STORAGE_FINGERPRINT (pairing payloads carry it)",
    "  404 'the remote console is off'  -> the server runs with --remote-console off",
    "",
    "Add --debug (or STORAGE_DEBUG=1) to print every request and its status to stderr.",
  ].join("\n");
}
