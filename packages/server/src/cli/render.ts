// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Every CLI help surface, rendered from `spec.ts`: --help, `commands`,
// manual pages, --help-agent and --debug-agent. Plain text, no ANSI.

import { VERSION } from "../version.ts";
import {
  BIN,
  COMMANDS,
  type CommandSpec,
  ENV_VARS,
  type FlagSpec,
  GLOBAL_FLAGS,
} from "./spec.ts";

const flagLabel = (f: FlagSpec) =>
  `--${f.name}${f.type === "bool" ? "" : ` ${f.value ?? `<${f.type}>`}`}${f.type === "list" ? " (repeatable)" : ""}`;

export function renderTopHelp(): string {
  const width = Math.max(...COMMANDS.map((c) => c.name.length));
  return [
    `${BIN} ${VERSION} — self-hosted, end-to-end encrypted storage for local-first apps`,
    "",
    `Usage: ${BIN} [command] [flags]     (default command: serve)`,
    "",
    "Commands:",
    ...COMMANDS.map((c) => `  ${c.name.padEnd(width)}  ${c.summary}`),
    "",
    "Global flags:",
    ...GLOBAL_FLAGS.map((f) => `  ${flagLabel(f).padEnd(28)} ${f.description}`),
    "  --help-agent                 Prompt-ready description of this tool.",
    "  --debug-agent                Prompt-ready troubleshooting context.",
    "",
    `Run '${BIN} <command> --help' or '${BIN} man <command>' for details.`,
  ].join("\n");
}

export function renderCommandHelp(c: CommandSpec): string {
  const lines = [`${c.summary}`, "", `Usage: ${c.usage}`, "", c.description];
  if (c.subcommands?.length) {
    lines.push(
      "",
      "Subcommands:",
      ...c.subcommands.map((s) => `  ${s.usage}\n      ${s.summary}`),
    );
  }
  if (c.flags.length) {
    lines.push("", "Flags:");
    for (const f of c.flags) {
      lines.push(
        `  ${flagLabel(f).padEnd(34)} ${f.description}${f.default ? ` [default: ${f.default}]` : ""}${f.env ? ` [env: ${f.env}]` : ""}`,
      );
    }
  }
  lines.push(
    "",
    "Examples:",
    ...c.examples.map((e) => `  ${e.cmd}${e.note ? `    # ${e.note}` : ""}`),
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
  if (c.subcommands?.length) {
    lines.push("subcommands:");
    for (const s of c.subcommands) lines.push(`  ${s.name}: ${s.usage}`);
  }
  lines.push("flags:");
  for (const f of [...c.flags, ...GLOBAL_FLAGS]) {
    lines.push(
      `  --${f.name}  type=${f.type}${f.default ? `  default=${f.default}` : ""}${f.env ? `  env=${f.env}` : ""}  ${f.description}`,
    );
  }
  lines.push(
    "exit-codes:",
    ...c.exitCodes.map((e) => `  ${e.code}  ${e.meaning}`),
  );
  return lines.join("\n");
}

export function renderExamples(c?: CommandSpec): string {
  const list = c ? [c] : COMMANDS;
  return list
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

/** The manual page for a command, as committed under man/<command>.md. */
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
  if (c.subcommands?.length) {
    out.push(
      "",
      "## Subcommands",
      "",
      "| Subcommand | Usage | Description |",
      "|---|---|---|",
    );
    for (const s of c.subcommands)
      out.push(`| \`${s.name}\` | \`${s.usage}\` | ${s.summary} |`);
  }
  out.push(
    "",
    "## Options",
    "",
    "| Flag | Type | Default | Environment | Description |",
    "|---|---|---|---|---|",
  );
  for (const f of [...c.flags, ...GLOBAL_FLAGS]) {
    out.push(
      `| \`--${f.name}\` | ${f.type} | ${f.default ? `\`${f.default}\`` : "—"} | ${f.env ? `\`${f.env}\`` : "—"} | ${f.description} |`,
    );
  }
  out.push("", "## Exit codes", "", "| Code | Meaning |", "|---|---|");
  for (const e of c.exitCodes) out.push(`| ${e.code} | ${e.meaning} |`);
  const envs = [...c.flags, ...GLOBAL_FLAGS]
    .filter((f) => f.env)
    .map((f) => f.env!);
  out.push("", "## Environment", "");
  out.push(
    envs.length
      ? envs.map((e) => `- \`${e}\``).join("\n")
      : "This command reads no environment variables beyond the global ones.",
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

export function renderHelpAgent(): string {
  return [
    `${BIN} ${VERSION}: a self-hosted, zero-knowledge storage server for local-first PWAs built on @niclaslindstedt/oss-framework.`,
    "Apps encrypt everything on the device; the server stores ciphertext files and rows per namespace, detects conflicts atomically,",
    "keeps history and a trash, streams change events, shares single namespaces between accounts, pairs devices by QR code,",
    "gets its own HTTPS certificates (ACME) and forwards router ports (UPnP / NAT-PMP).",
    "",
    "Commands:",
    ...COMMANDS.map((c) => `  ${c.name}: ${c.summary}`),
    "",
    "Most important flags:",
    ...[
      "data-dir",
      "tls",
      "domain",
      "port",
      "http-port",
      "upnp",
      "public-url",
    ].map((n) => {
      const f = [...GLOBAL_FLAGS, ...COMMANDS[0]!.flags].find(
        (x) => x.name === n,
      )!;
      return `  --${f.name}: ${f.description}${f.env ? ` (env ${f.env})` : ""}`;
    }),
    "",
    "Discover more (recommended for agents):",
    `  ${BIN} commands                  # every command, one per line`,
    `  ${BIN} commands pair             # full flag/exit-code spec of one command`,
    `  ${BIN} commands --examples       # example invocations`,
    `  ${BIN} man <command>             # reference manual page`,
    `  ${BIN} docs [topic]              # embedded guides (getting started, home hosting, security, protocol)`,
    `  ${BIN} --debug-agent             # troubleshooting context`,
  ].join("\n");
}

export function renderDebugAgent(info: {
  dataDir: string;
  logFile: string;
  configFile: string;
}): string {
  return [
    `${BIN} ${VERSION} troubleshooting context`,
    `node ${process.version} on ${process.platform}/${process.arch}`,
    "",
    "Logs:",
    `  debug log (always on, plain text, one line per event, appended): ${info.logFile}`,
    `  terminal output mirrors status/warn/error lines; add --debug (or STORAGE_DEBUG=1) for debug lines on stderr`,
    "  the tamper-evident audit log lives in the database: storage-server audit tail",
    "",
    "Configuration precedence: flags > environment > config.json > defaults",
    `  data dir: ${info.dataDir}`,
    `  config file: ${info.configFile} (JSON, same keys as the server config)`,
    "",
    "Environment variables:",
    ...ENV_VARS.map((e) => `  ${e.name}: ${e.description}`),
    "",
    "Common failures and how to diagnose them:",
    "  devices cannot connect           -> storage-server doctor --public-url <url>; curl -v <url>/v1/info",
    "  certificate errors in the app    -> storage-server cert status (acme: check --domain and that port 80 or 443 is reachable)",
    "  port forwarding does not work    -> storage-server upnp status (CGNAT / double NAT is reported explicitly)",
    "  'origin not allowed' in browser  -> the app origin was never paired: pair from that origin or add --cors-origin",
    "  401 after an app update          -> the device was revoked or its account disabled: storage-server devices list",
    "  database or audit problems       -> storage-server audit verify; storage-server doctor",
    "  data looks stale on a device     -> the app pulls /v1/ns/<id>/changes; a 410 means the device must resync",
    "",
    "Capture a reproducer: run with --debug, reproduce, then attach the debug log and `storage-server doctor` output.",
    "Never attach the data dir: it contains the (encrypted) data and the TLS private key.",
  ].join("\n");
}
