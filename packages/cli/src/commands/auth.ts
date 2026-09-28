// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// `auth` and `context`: logging in (admin token or admin-device pairing),
// the saved contexts, and handing credentials to scripts and containers.

import { hostname as osHostname } from "node:os";

import { UsageError } from "../args.ts";
import type { Cli } from "../cli.ts";
import {
  ApiError,
  AuthError,
  ConsoleClient,
  normalizeUrl,
  parseJson,
  type Target,
} from "../client.ts";
import { type Context, CONTEXT_NAME, contextName } from "../config.ts";
import {
  encodeSession,
  type LoginInput,
  newDeviceKeys,
  parseLoginInput,
} from "../device.ts";
import { send } from "../http.ts";
import type { Overview } from "../../../server/src/admin/ui/types.ts";
import { DEFAULT_CONSOLE_URL, EXIT } from "../spec.ts";

const PROMPT =
  "Paste the console's sign-in link (from `storage-server admin`)\nor an admin-device pairing payload (from `storage-server pair --account <admin> --console`):\n> ";

async function loginInput(cli: Cli): Promise<LoginInput> {
  const arg = cli.args.positionals[0];
  const fp = cli.str("fingerprint") ?? cli.env.STORAGE_FINGERPRINT;
  const url = cli.str("url");
  let input: LoginInput | null;
  if (arg !== undefined) {
    if (cli.bool("with-token") || cli.str("code"))
      throw new UsageError("give a link or --with-token/--code, not both");
    input = parseLoginInput(arg);
    if (!input)
      throw new UsageError(
        "not a console sign-in link (http://…/login?token=…) or a pairing payload (oss-storage://pair?…)",
      );
  } else if (cli.bool("with-token")) {
    const token = (await cli.deps.readStdin()).trim();
    if (!token) throw new UsageError("no token on standard input");
    input = {
      kind: "token",
      url: normalizeUrl(url ?? DEFAULT_CONSOLE_URL),
      token,
    };
  } else if (cli.str("code")) {
    if (!url) throw new UsageError("--code needs --url (the server's URL)");
    input = { kind: "pairing", url: normalizeUrl(url), code: cli.str("code")! };
  } else if (cli.deps.stdinTty) {
    input = parseLoginInput(await cli.deps.prompt(PROMPT, { secret: true }));
    if (!input)
      throw new UsageError(
        "that is neither a sign-in link nor a pairing payload",
      );
  } else {
    throw new UsageError(
      "give a sign-in link or pairing payload, --with-token (token on stdin) or --code with --url",
    );
  }
  if (input.kind === "pairing" && fp) input.fp = fp;
  if (input.kind === "token" && url && arg !== undefined)
    input.url = normalizeUrl(url);
  return input;
}

/** Save a context: re-use the name of one with the same URL and kind. */
function save(cli: Cli, ctx: Context, suggested: string): string {
  const explicit = cli.str("context");
  if (explicit && !CONTEXT_NAME.test(explicit))
    throw new UsageError("a context name is letters, digits, '.', '_' and '-'");
  let name = explicit ?? "";
  cli.store.update((config) => {
    if (!name) {
      const same = Object.entries(config.contexts).find(
        ([, c]) =>
          normalizeUrl(c.url) === normalizeUrl(ctx.url) &&
          c.auth.type === ctx.auth.type,
      );
      name = same
        ? same[0]
        : contextName(suggested, Object.keys(config.contexts));
    }
    config.contexts[name] = ctx;
    config.current = name;
  });
  return name;
}

async function loginWithToken(
  cli: Cli,
  input: Extract<LoginInput, { kind: "token" }>,
) {
  const target: Target = {
    source: "login",
    url: input.url,
    auth: { type: "token", token: input.token },
  };
  const overview = await cli.client(target).get<Overview>("/api/overview");
  const name = save(
    cli,
    {
      url: input.url,
      server: overview.server.name,
      createdAt: new Date(cli.now()).toISOString(),
      auth: target.auth,
    },
    overview.server.name,
  );
  cli.ok(
    `Logged in to ${cli.style.bold(overview.server.name)} (${input.url}) with the admin token — context ${cli.style.bold(name)}`,
  );
  return EXIT.ok;
}

async function loginWithPairing(
  cli: Cli,
  input: Extract<LoginInput, { kind: "pairing" }>,
) {
  const info = await send({
    method: "GET",
    url: `${input.url}/v1/info`,
    fp: input.fp,
    signal: cli.deps.signal,
  })
    .then(
      (r) =>
        parseJson(r.body) as {
          serverId?: string;
          name?: string;
          capabilities?: string[];
        },
    )
    .catch((err: Error) => {
      throw new Error(`cannot reach ${input.url}: ${err.message}`);
    });
  if (!info?.serverId)
    throw new Error(
      `${input.url} does not look like a storage server (no /v1/info)`,
    );
  if (!info.capabilities?.includes("console"))
    throw new Error(
      `${info.name ?? input.url} does not offer the remote console (it runs with --remote-console off); log in with the admin token on its machine instead`,
    );
  const keys = newDeviceKeys();
  const deviceName =
    cli.str("name") ??
    `storage CLI on ${cli.deps.hostname ?? osHostname()}`.slice(0, 64);
  const res = await send({
    method: "POST",
    url: `${input.url}/v1/pair`,
    fp: input.fp,
    signal: cli.deps.signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      code: input.code,
      device: {
        name: deviceName,
        platform: "cli",
        dskPublic: keys.dskPublic,
        dekPublic: keys.dekPublic,
      },
    }),
  });
  const paired = parseJson(res.body) as {
    deviceId?: string;
    serverId?: string;
    console?: boolean;
    account?: { name: string };
    error?: { message: string };
  };
  if (res.status >= 400 || !paired.deviceId)
    throw new AuthError(
      `pairing failed: ${paired.error?.message ?? `HTTP ${res.status}`}`,
    );
  const target: Target = {
    source: "login",
    url: input.url,
    auth: {
      type: "device",
      serverId: paired.serverId ?? info.serverId,
      deviceId: paired.deviceId,
      key: keys.key,
      ...(input.fp ? { fp: input.fp } : {}),
    },
  };
  const client = cli.client(target);
  if (!paired.console) {
    // An ordinary device is of no use here: take it back off the account.
    await client
      .device("DELETE", `/v1/devices/${paired.deviceId}`)
      .catch(() => undefined);
    throw new AuthError(
      'that code pairs an ordinary device, not an admin device: on the server run `storage-server pair --account <admin> --console`, or use "Pair admin app" in the local console',
    );
  }
  const overview = await client.get<Overview>("/api/overview");
  const name = save(
    cli,
    {
      url: input.url,
      server: overview.server.name,
      account: paired.account?.name,
      createdAt: new Date(cli.now()).toISOString(),
      auth: target.auth,
    },
    input.name ?? overview.server.name,
  );
  cli.ok(
    `Logged in to ${cli.style.bold(overview.server.name)} (${input.url}) as admin device ${paired.deviceId} of ${paired.account?.name ?? "an admin"} — context ${cli.style.bold(name)}`,
  );
  cli.err(
    cli.style.dim(
      "The device key is kept in the CLI's config file. It signs in only: it never receives an account key, so no data can be read with it.",
    ),
  );
  return EXIT.ok;
}

export async function authLogin(cli: Cli): Promise<number> {
  const input = await loginInput(cli);
  return input.kind === "token"
    ? loginWithToken(cli, input)
    : loginWithPairing(cli, input);
}

/** The saved context a context-only command acts on. */
function savedContext(cli: Cli): { name: string; ctx: Context } {
  const target = cli.target();
  if (!target.context)
    throw new UsageError(
      `the credentials come from ${target.source}, not a saved context: unset it to log out`,
    );
  return {
    name: target.context,
    ctx: cli.store.read().contexts[target.context]!,
  };
}

export async function authLogout(cli: Cli): Promise<number> {
  const { name, ctx } = savedContext(cli);
  if (ctx.auth.type === "device" && !cli.bool("keep-device")) {
    const client = cli.client(cli.target());
    try {
      await client.device("DELETE", `/v1/devices/${ctx.auth.deviceId}`);
      cli.ok(
        `Revoked admin device ${ctx.auth.deviceId} on ${ctx.server ?? ctx.url}`,
      );
    } catch (err) {
      cli.err(
        cli.style.yellow(
          `warning: could not revoke admin device ${ctx.auth.deviceId} (${(err as Error).message}); revoke it from the console`,
        ),
      );
    }
  }
  cli.store.update((config) => {
    delete config.contexts[name];
    if (config.current === name) config.current = null;
  });
  cli.ok(`Logged out of ${ctx.server ?? ctx.url} (context ${name} removed)`);
  return EXIT.ok;
}

type Check = {
  name: string | null;
  current: boolean;
  source: string;
  url: string;
  auth: "token" | "device";
  deviceId?: string;
  account?: string;
  ok: boolean;
  error?: string;
};

async function check(cli: Cli, target: Target): Promise<Check> {
  const base: Check = {
    name: target.context ?? null,
    current: false,
    source: target.source,
    url: target.url,
    auth: target.auth.type,
    ok: false,
  };
  if (target.auth.type === "device") base.deviceId = target.auth.deviceId;
  const client: ConsoleClient = cli.client(target);
  try {
    if (target.auth.type === "device") {
      const me = await client.device<{
        account: { name: string };
        console: boolean;
      }>("GET", "/v1/me");
      base.account = me.account.name;
      if (!me.console)
        throw new Error(
          "no longer an admin device (access removed or account demoted)",
        );
    } else {
      await client.get("/api/metrics");
    }
    base.ok = true;
  } catch (err) {
    base.error = (err as Error).message;
  }
  return base;
}

export async function authStatus(cli: Cli): Promise<number> {
  let active: Target | null = null;
  let activeError: string | null = null;
  try {
    active = cli.target();
  } catch (err) {
    if (!(err instanceof AuthError)) throw err;
    activeError = err.message;
  }
  const config = cli.store.read();
  const checks: Check[] = [];
  if (active && !active.context)
    checks.push({ ...(await check(cli, active)), current: true });
  for (const [name, ctx] of Object.entries(config.contexts)) {
    const target: Target = {
      source: `context "${name}"`,
      context: name,
      url: ctx.url,
      auth: ctx.auth,
    };
    const c = await check(cli, target);
    c.current = active?.context === name;
    checks.push(c);
  }
  if (cli.bool("json")) {
    cli.out(JSON.stringify(checks, null, 2));
  } else {
    const s = cli.style;
    if (!checks.length) cli.err(activeError ?? "not logged in");
    for (const c of checks) {
      const mark = c.ok ? s.green("✓") : s.red("✗");
      const who =
        c.auth === "token"
          ? "admin token"
          : `admin device ${c.deviceId}${c.account ? ` of ${c.account}` : ""}`;
      cli.out(
        `${mark} ${s.bold(c.name ?? c.source)}${c.current ? s.cyan(" (active)") : ""}  ${c.url}  ${s.dim(who)}`,
      );
      if (!c.name) cli.out(`  ${s.dim(`from ${c.source}`)}`);
      if (c.error) cli.out(`  ${s.red(c.error)}`);
    }
    if (activeError && checks.length) cli.err(s.yellow(activeError));
  }
  const current = checks.find((c) => c.current);
  if (!current) return EXIT.auth;
  return current.ok ? EXIT.ok : EXIT.auth;
}

export async function authToken(cli: Cli): Promise<number> {
  const target = cli.target();
  if (target.auth.type === "token") cli.out(target.auth.token);
  else cli.out(await cli.client(target).deviceToken());
  return EXIT.ok;
}

export async function authExport(cli: Cli): Promise<number> {
  const target = cli.target();
  if (cli.tty)
    cli.err(
      cli.style.yellow(
        "# These lines are credentials: keep the file private (chmod 600).",
      ),
    );
  if (target.auth.type === "token") {
    cli.out(`STORAGE_URL=${target.url}`);
    cli.out(`STORAGE_TOKEN=${target.auth.token}`);
  } else {
    cli.out(
      `STORAGE_SESSION=${encodeSession({
        url: target.url,
        serverId: target.auth.serverId,
        deviceId: target.auth.deviceId,
        key: target.auth.key,
        fp: target.auth.fp,
      })}`,
    );
  }
  return EXIT.ok;
}

// ---------------------------------------------------------------- context

export async function context(cli: Cli, sub: string): Promise<number> {
  const config = cli.store.read();
  const exists = (name: string) => {
    if (!config.contexts[name])
      throw new UsageError(
        `no context named "${name}" (run \`storage context ls\`)`,
      );
  };
  switch (sub) {
    case "ls": {
      let active: string | undefined;
      try {
        active = cli.target().context;
      } catch {
        active = undefined;
      }
      const rows = Object.entries(config.contexts).map(([name, c]) => ({
        name,
        current: name === active,
        url: c.url,
        auth: c.auth.type,
        server: c.server ?? null,
        account: c.account ?? null,
        deviceId: c.auth.type === "device" ? c.auth.deviceId : null,
        createdAt: c.createdAt,
      }));
      cli.printList(
        rows,
        [
          {
            header: "name",
            value: (r) => `${r.name}${r.current && cli.tty ? " *" : ""}`,
          },
          { header: "server", value: (r) => r.server ?? "" },
          { header: "url", value: (r) => r.url },
          {
            header: "auth",
            value: (r) =>
              r.auth === "token"
                ? "admin token"
                : `admin device (${r.account ?? "?"})`,
          },
        ],
        { key: (r) => r.name, empty: "no contexts: run `storage auth login`" },
      );
      return EXIT.ok;
    }
    case "use": {
      const name = cli.arg(0);
      exists(name);
      cli.store.update((c) => (c.current = name));
      cli.ok(
        `Now using context ${cli.style.bold(name)} (${config.contexts[name]!.url})`,
      );
      return EXIT.ok;
    }
    case "show": {
      const t = cli.target();
      cli.out(t.context ?? t.source);
      return EXIT.ok;
    }
    case "rename": {
      const [from, to] = [cli.arg(0), cli.arg(1)];
      exists(from);
      if (!CONTEXT_NAME.test(to))
        throw new UsageError(
          "a context name is letters, digits, '.', '_' and '-'",
        );
      if (config.contexts[to])
        throw new UsageError(`a context named "${to}" exists`);
      cli.store.update((c) => {
        c.contexts[to] = c.contexts[from]!;
        delete c.contexts[from];
        if (c.current === from) c.current = to;
      });
      cli.ok(`Renamed context ${from} to ${to}`);
      return EXIT.ok;
    }
    case "rm": {
      for (const name of cli.args.positionals) exists(name);
      cli.store.update((c) => {
        for (const name of cli.args.positionals) {
          delete c.contexts[name];
          if (c.current === name) c.current = null;
        }
      });
      for (const name of cli.args.positionals)
        cli.ok(`Removed context ${name}`);
      return EXIT.ok;
    }
  }
  throw new ApiError(0, "internal", `unhandled context subcommand ${sub}`);
}
