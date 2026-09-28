// A real storage server (device API + remote console) with its local
// console listener, and the CLI run in-process against it.

import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach } from "vitest";

import {
  type AdminConsole,
  startAdminConsole,
} from "../../server/src/admin/console.ts";
import {
  createStorageServer,
  type StorageServer,
} from "../../server/src/app.ts";
import { createMemoryLogger } from "../../server/src/log.ts";
import { runCli } from "../src/main.ts";

const open: { close(): Promise<void> }[] = [];
const dirs: string[] = [];
afterEach(async () => {
  for (const o of open.splice(0).reverse()) await o.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

export function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "storage-cli-"));
  dirs.push(d);
  return d;
}

export type Harness = {
  app: StorageServer;
  admin: AdminConsole;
  /** The device API's URL (where admin devices go). */
  apiUrl: string;
  /** The console's sign-in link. */
  loginUrl: string;
};

export async function harness(
  config: { remoteConsole?: boolean } = {},
): Promise<Harness> {
  const app = createStorageServer({
    log: createMemoryLogger(),
    config: {
      name: "home",
      tls: { mode: "off" },
      listen: { host: "127.0.0.1" },
      ...config,
    },
    console: {},
  });
  const apiUrl = await app.listen(0);
  const admin = await startAdminConsole(
    app.console!.state.deps,
    { host: "127.0.0.1", port: 0 },
    app.console!,
  );
  open.push(app, admin);
  return { app, admin, apiUrl, loginUrl: admin.loginUrl() };
}

export type Run = { code: number; out: string; err: string };

export type Shell = {
  /** Run `storage <argv>`; `answers` feed prompts, `stdin` feeds --with-token. */
  (
    argv: string[],
    opts?: {
      env?: Record<string, string>;
      answers?: string[];
      stdin?: string;
      stdinTty?: boolean;
      signal?: AbortSignal;
      onOut?: (line: string) => void;
    },
  ): Promise<Run>;
  home: string;
  configDir: string;
};

/** A fresh user: own HOME, config directory, working directory. */
export function shell(baseEnv: Record<string, string> = {}): Shell {
  const home = tmp();
  const configDir = join(home, "config");
  const dataDir = join(home, "no-server-here");
  mkdirSync(dataDir);
  const run = (async (argv, opts = {}) => {
    const out: string[] = [];
    const err: string[] = [];
    const answers = [...(opts.answers ?? [])];
    const code = await runCli(argv, {
      out: (t) => {
        out.push(t);
        opts.onOut?.(t);
      },
      err: (t) => err.push(t),
      env: {
        HOME: home,
        STORAGE_CONFIG_DIR: configDir,
        STORAGE_DATA_DIR: dataDir,
        ...baseEnv,
        ...opts.env,
      },
      cwd: home,
      tty: false,
      stdinTty: opts.stdinTty ?? answers.length > 0,
      readStdin: async () => opts.stdin ?? "",
      prompt: async () => answers.shift() ?? "",
      signal: opts.signal ?? new AbortController().signal,
      hostname: "laptop",
    });
    return { code, out: out.join("\n"), err: err.join("\n") };
  }) as Shell;
  run.home = home;
  run.configDir = configDir;
  return run;
}

export const json = <T = any>(r: Run): T => JSON.parse(r.out) as T; // eslint-disable-line @typescript-eslint/no-explicit-any
