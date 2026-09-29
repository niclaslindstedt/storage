// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Logging. Semantic helpers — `status`, `header`, `info`,
// `warn`, `error` — write to stderr (styled when it is a TTY) AND to an
// always-on debug log file; `debug` goes to the file, and to stderr only with
// `--debug`. stdout is reserved for a command's result (JSON, QR codes, the
// agent surfaces), so it pipes cleanly. Nothing user-authored is ever logged:
// the server never holds a plaintext to log, and ciphertext, tokens and codes
// are kept out by convention (log ids and sizes, never bodies or secrets).

import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export interface Logger {
  header(message: string): void;
  status(message: string): void;
  info(message: string): void;
  warn(message: string, err?: unknown): void;
  error(message: string, err?: unknown): void;
  debug(message: string): void;
}

export type LoggerOptions = {
  /** Always-on debug log file; `null` disables file logging. */
  file: string | null;
  /** Mirror debug lines to stderr. */
  debug: boolean;
  /** Sink for status/info/header lines; defaults to stderr (like `err`). */
  out?: (line: string) => void;
  err?: (line: string) => void;
  color?: boolean;
};

const style = (code: string, text: string, on: boolean) =>
  on ? `\u001b[${code}m${text}\u001b[0m` : text;

function describe(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return err === undefined ? "" : String(err);
}

export function createLogger(options: LoggerOptions): Logger {
  const errOut = options.err ?? ((l: string) => process.stderr.write(l + "\n"));
  const out = options.out ?? errOut;
  const color = options.color ?? Boolean(process.stderr.isTTY);
  let fileOk = options.file !== null;
  if (options.file) {
    try {
      mkdirSync(dirname(options.file), { recursive: true, mode: 0o700 });
    } catch {
      fileOk = false;
    }
  }

  function file(level: string, message: string) {
    if (!fileOk || !options.file) return;
    try {
      appendFileSync(
        options.file,
        `${new Date().toISOString()} ${level.padEnd(5)} ${message}\n`,
        { mode: 0o600 },
      );
    } catch {
      fileOk = false;
    }
  }

  return {
    header(message) {
      file("INFO", `== ${message} ==`);
      out(style("1", message, color));
    },
    status(message) {
      file("INFO", message);
      out(`${style("32", "✓", color)} ${message}`);
    },
    info(message) {
      file("INFO", message);
      out(message);
    },
    warn(message, err) {
      const line =
        err === undefined ? message : `${message} (${describe(err)})`;
      file("WARN", line);
      errOut(`${style("33", "warning:", color)} ${line}`);
    },
    error(message, err) {
      const line =
        err === undefined ? message : `${message} (${describe(err)})`;
      file("ERROR", line);
      errOut(`${style("31", "error:", color)} ${line}`);
    },
    debug(message) {
      file("DEBUG", message);
      if (options.debug) errOut(style("2", message, color));
    },
  };
}

/** A logger that records lines in memory — for tests and embedding. */
export function createMemoryLogger(): Logger & { lines: string[] } {
  const lines: string[] = [];
  const push = (level: string) => (message: string, err?: unknown) =>
    lines.push(
      `${level} ${message}${err === undefined ? "" : ` (${describe(err)})`}`,
    );
  return {
    lines,
    header: push("HEADER"),
    status: push("STATUS"),
    info: push("INFO"),
    warn: push("WARN"),
    error: push("ERROR"),
    debug: push("DEBUG"),
  };
}
