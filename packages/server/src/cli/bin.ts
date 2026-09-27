#!/usr/bin/env node
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Process entry point. Silences Node's one-time "SQLite is experimental"
// warning (node:sqlite is stable enough for this use and the warning would
// alarm operators), then loads the CLI.

process.removeAllListeners("warning");
process.on("warning", (w) => {
  if (w.name === "ExperimentalWarning" && /SQLite/i.test(w.message)) return;
  process.stderr.write(`${w.name}: ${w.message}\n`);
});

const { runCli } = await import("./main.ts");
const controller = new AbortController();
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.once(sig, () => controller.abort());
}
const code = await runCli(process.argv.slice(2), {
  out: (t) => process.stdout.write(`${t}\n`),
  err: (t) => process.stderr.write(`${t}\n`),
  env: process.env,
  signal: controller.signal,
  tty: Boolean(process.stdout.isTTY),
});
process.exitCode = code;
