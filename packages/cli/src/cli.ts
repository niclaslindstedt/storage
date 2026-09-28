// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// What a command gets: output sinks, the effective environment, parsed
// flags, the config store and a lazily built console client — injected so
// the whole CLI runs in-process under test.

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { type Flags, type ParsedArgs, UsageError } from "./args.ts";
import {
  AuthError,
  ConsoleClient,
  NOT_LOGGED_IN,
  resolveTarget,
  type Target,
} from "./client.ts";
import { ConfigStore, TokenCache } from "./config.ts";
import type { Env } from "./env.ts";
import {
  type Column,
  renderTemplate,
  style,
  type Style,
  table,
} from "./output.ts";

export type CliDeps = {
  /** A line on stdout. */
  out: (text: string) => void;
  /** Raw bytes on stdout (downloads to '-'). */
  write?: (chunk: string | Buffer) => void;
  /** A line on stderr. */
  err: (text: string) => void;
  env: Env;
  cwd: string;
  /** Whether stdout is a terminal. */
  tty: boolean;
  /** Whether stdin is a terminal (prompts are possible). */
  stdinTty: boolean;
  readStdin: () => Promise<string>;
  /** Ask a question on the terminal; `secret` hides the answer. */
  prompt: (question: string, opts?: { secret?: boolean }) => Promise<string>;
  signal: AbortSignal;
  platform?: NodeJS.Platform;
  hostname?: string;
  now?: () => number;
};

export class Cli {
  private cachedClient: ConsoleClient | null = null;
  readonly now: () => number;

  constructor(
    readonly deps: CliDeps,
    readonly args: ParsedArgs,
    /** Process environment layered over .env files. */
    readonly env: Env,
    readonly store: ConfigStore,
    /** ANSI colours on (a terminal, and neither NO_COLOR nor --no-color). */
    readonly color: boolean,
    readonly debug: boolean,
  ) {
    this.now = deps.now ?? Date.now;
    this.style = style(color);
  }

  readonly style: Style;

  get flags(): Flags {
    return this.args.flags;
  }
  get tty(): boolean {
    return this.deps.tty;
  }
  out(text: string): void {
    this.deps.out(text);
  }
  err(text: string): void {
    this.deps.err(text);
  }

  str(name: string): string | undefined {
    const v = this.flags[name];
    return typeof v === "string" ? v : undefined;
  }
  bool(name: string): boolean {
    return this.flags[name] === true;
  }
  int(name: string, dflt: number): number {
    const v = this.flags[name];
    return typeof v === "number" ? v : dflt;
  }
  list(name: string): string[] {
    const v = this.flags[name];
    return Array.isArray(v) ? v : [];
  }
  arg(i: number): string {
    return this.args.positionals[i]!;
  }

  /** The target, or AuthError when there are no credentials at all. */
  target(): Target {
    const t = resolveTarget({
      env: this.env,
      cwd: this.deps.cwd,
      store: this.store,
      context: this.str("context"),
      platform: this.deps.platform,
    });
    if (!t) throw new AuthError(NOT_LOGGED_IN);
    return t;
  }

  client(target?: Target): ConsoleClient {
    if (target) return this.makeClient(target);
    return (this.cachedClient ??= this.makeClient(this.target()));
  }

  makeClient(target: Target): ConsoleClient {
    return new ConsoleClient(target, {
      cache: new TokenCache(this.store.dir, this.now),
      debug: this.debug ? (l) => this.err(this.style.dim(`» ${l}`)) : undefined,
      warn: (l) => this.err(this.style.yellow(l)),
      signal: this.deps.signal,
    });
  }

  /** Ask before a destructive action; --yes skips, no terminal refuses. */
  async confirm(question: string, expected?: string): Promise<void> {
    if (this.bool("yes")) return;
    if (!this.deps.stdinTty)
      throw new UsageError(
        `${question} — pass --yes to confirm without a terminal`,
      );
    const answer = (
      await this.deps.prompt(
        expected
          ? `${question}\nType ${this.style.bold(expected)} to confirm: `
          : `${question} [y/N] `,
      )
    ).trim();
    const ok = expected ? answer === expected : /^y(es)?$/i.test(answer);
    if (!ok) throw new Cancelled();
  }

  /**
   * Print a list: --json (the API's JSON), -q (keys), --format (template),
   * or a table.
   */
  printList<T>(
    rows: T[],
    columns: Column<T>[],
    opts: { key: (row: T) => string; json?: unknown; empty?: string },
  ): void {
    if (this.bool("json"))
      return this.out(JSON.stringify(opts.json ?? rows, null, 2));
    if (this.bool("quiet")) {
      if (rows.length) this.out(rows.map(opts.key).join("\n"));
      return;
    }
    const format = this.str("format");
    if (format !== undefined) {
      if (format === "json") {
        for (const r of rows) this.out(JSON.stringify(r));
        return;
      }
      for (const r of rows) this.out(renderTemplate(format, r));
      return;
    }
    if (!rows.length) {
      if (this.tty && opts.empty) this.err(this.style.dim(opts.empty));
      return;
    }
    this.out(table(rows, columns, this.tty));
  }

  /** Save bytes to a file, or stdout for '-'. */
  save(output: string, body: Buffer): string | null {
    if (output === "-") {
      if (this.deps.write) this.deps.write(body);
      else this.out(body.toString("utf8"));
      return null;
    }
    const path = resolve(this.deps.cwd, output);
    writeFileSync(path, body);
    return path;
  }

  ok(message: string): void {
    // Confirmations go to stderr so stdout stays clean for data.
    this.err(`${this.style.green("✓")} ${message}`);
  }
}

/** The user answered no to a confirmation. */
export class Cancelled extends Error {
  constructor() {
    super("cancelled");
    this.name = "Cancelled";
  }
}
