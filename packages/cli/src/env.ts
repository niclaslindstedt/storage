// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The environment the CLI reads: the process environment layered over
// .env files (`--env-file`, or ./.env when present), plus `*_FILE`
// indirection for secrets (Docker secrets, the server's admin.token).
// The process environment always wins over a file, as in Docker Compose.

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { UsageError } from "./args.ts";

export type Env = Record<string, string | undefined>;

/** Parse a .env file: KEY=value, `export KEY=value`, quotes, # comments. */
export function parseDotenv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line || line.startsWith("#")) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_.]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1]!;
    let value = m[2]!;
    const quote = value[0];
    if (quote === '"' || quote === "'" || quote === "`") {
      // A quoted value may span lines until its closing quote.
      let body = value.slice(1);
      while (!closes(body, quote) && i + 1 < lines.length)
        body += `\n${lines[++i]}`;
      const end = closingIndex(body, quote);
      body = end >= 0 ? body.slice(0, end) : body;
      value =
        quote === '"'
          ? body.replace(/\\([nrt"\\$])/g, (_, c: string) =>
              c === "n" ? "\n" : c === "r" ? "\r" : c === "t" ? "\t" : c,
            )
          : body;
    } else {
      value = value.replace(/\s+#.*$/, "").trim();
    }
    out[key] = value;
  }
  return out;
}

function closingIndex(body: string, quote: string): number {
  for (let i = 0; i < body.length; i++) {
    if (body[i] === "\\" && quote === '"') {
      i++;
      continue;
    }
    if (body[i] === quote) return i;
  }
  return -1;
}

const closes = (body: string, quote: string) => closingIndex(body, quote) >= 0;

/**
 * The effective environment: .env files first (later files win), then the
 * process environment on top. Explicit files must exist; ./.env is
 * optional.
 */
export function loadEnv(
  processEnv: Env,
  files: string[] | undefined,
  cwd: string,
): { env: Env; loaded: string[] } {
  const explicit = files !== undefined && files.length > 0;
  const list = explicit ? files : [".env"];
  const merged: Env = {};
  const loaded: string[] = [];
  for (const f of list) {
    const path = resolve(cwd, f);
    if (!existsSync(path)) {
      if (explicit) throw new UsageError(`env file not found: ${f}`);
      continue;
    }
    Object.assign(merged, parseDotenv(readFileSync(path, "utf8")));
    loaded.push(path);
  }
  for (const [k, v] of Object.entries(processEnv))
    if (v !== undefined) merged[k] = v;
  return { env: merged, loaded };
}

/** A secret from `NAME`, or read from the file `NAME_FILE` names. */
export function secret(
  env: Env,
  name: string,
  cwd: string,
): string | undefined {
  const direct = env[name];
  if (direct) return direct.trim();
  const file = env[`${name}_FILE`];
  if (!file) return undefined;
  const path = resolve(cwd, file);
  if (!existsSync(path))
    throw new UsageError(`${name}_FILE points at a missing file: ${file}`);
  return readFileSync(path, "utf8").trim() || undefined;
}
