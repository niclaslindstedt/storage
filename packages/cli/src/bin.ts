#!/usr/bin/env node
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Process entry point: wires the CLI to stdin/stdout, the terminal and
// Ctrl-C (which ends a `logs -f` cleanly).

import { createInterface } from "node:readline";
import { Writable } from "node:stream";

const { runCli } = await import("./main.ts");

const controller = new AbortController();
for (const sig of ["SIGINT", "SIGTERM"] as const)
  process.once(sig, () => controller.abort());

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

/** Ask on the terminal (stderr), optionally without echoing the answer. */
function prompt(
  question: string,
  opts: { secret?: boolean } = {},
): Promise<string> {
  let muted = false;
  const output = new Writable({
    write(chunk, _enc, done) {
      if (!muted) process.stderr.write(chunk);
      done();
    },
  });
  const rl = createInterface({ input: process.stdin, output, terminal: true });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      if (opts.secret) process.stderr.write("\n");
      rl.close();
      resolve(answer);
    });
    muted = opts.secret === true;
  });
}

const code = await runCli(process.argv.slice(2), {
  out: (t) => process.stdout.write(`${t}\n`),
  write: (c) => process.stdout.write(c),
  err: (t) => process.stderr.write(`${t}\n`),
  env: process.env,
  cwd: process.cwd(),
  tty: Boolean(process.stdout.isTTY),
  stdinTty: Boolean(process.stdin.isTTY),
  readStdin,
  prompt,
  signal: controller.signal,
});
process.exitCode = code;
