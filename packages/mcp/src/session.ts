// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The agent device: the framework's self-hosted client on an encrypted file
// vault, confined to its one server. Everything that touches key material
// happens in the framework client, in this process; the server sees only
// what any other device of the account shows it.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  createSelfHostedClient,
  type SelfHostedClient,
} from "@niclaslindstedt/oss-framework/storage/selfhosted";

import type { McpConfig } from "./config.ts";
import { serverFetch } from "./net.ts";
import {
  type FileVault,
  openFileVault,
  type VaultKeySource,
  writePrivate,
} from "./vault.ts";

/** The drive's app id, as Storage Remote uses it (SPEC §11.2). */
export const DRIVE_APP = "drive";

export type Permission =
  | "data:read"
  | "data:write"
  | "sharing"
  | "devices"
  | "console:read"
  | "console:write";

export type AgentScope = { perms: Permission[]; apps: string[] | null };

export type Me = {
  account: { id: string; name: string; role: "admin" | "member" | "guest" };
  deviceId: string;
  console: boolean;
  agent: AgentScope | null;
};

/** What the MCP server keeps next to the vault (not secret). */
export type Profile = {
  server: string;
  /** The SPKI pin from the pairing code (self-signed servers). */
  pin?: string;
};

export function vaultSource(
  env: NodeJS.ProcessEnv = process.env,
): VaultKeySource {
  const p = env.STORAGE_MCP_PASSPHRASE;
  return p ? { kind: "passphrase", passphrase: p } : { kind: "keyfile" };
}

export function readProfile(dir: string): Profile | null {
  const file = join(dir, "profile.json");
  return existsSync(file)
    ? (JSON.parse(readFileSync(file, "utf8")) as Profile)
    : null;
}

export function writeProfile(dir: string, p: Profile): void {
  writePrivate(join(dir, "profile.json"), JSON.stringify(p, null, 2));
}

export function newClient(
  vault: FileVault,
  profile: Profile,
  config: Pick<McpConfig, "allowInsecureHttp">,
): SelfHostedClient {
  return createSelfHostedClient({
    vault,
    app: DRIVE_APP,
    fetchImpl: serverFetch(profile.server, {
      pin: profile.pin,
      allowInsecureHttp: config.allowInsecureHttp,
    }),
  });
}

export class NotPairedError extends Error {
  constructor() {
    super(
      "this agent is not paired: run `storage-mcp pair '<pairing code>'` first",
    );
  }
}

export type Session = {
  client: SelfHostedClient;
  vault: FileVault;
  profile: Profile;
  me: Me;
  /** Whether the account key is on this device (files and rows readable). */
  ready: boolean;
};

export async function openSession(
  dir: string,
  config: McpConfig,
  env: NodeJS.ProcessEnv = process.env,
): Promise<Session> {
  const profile = readProfile(dir);
  if (!profile) throw new NotPairedError();
  const vault = openFileVault(dir, vaultSource(env));
  const client = newClient(vault, profile, config);
  const state = await client.restore();
  if (state === "signed-out") throw new NotPairedError();
  const me = await client.transport.json<Me>("GET", "/v1/me");
  const ready = state === "ready" || (await client.refreshKeys()) === "ready";
  return {
    client,
    vault,
    profile,
    me: { ...me, agent: me.agent ?? null },
    ready,
  };
}

/** Call the admin console's API as this admin device (SPEC §11.2). */
export async function consoleJson<T>(
  client: SelfHostedClient,
  method: string,
  path: string,
  body?: unknown,
  query?: Record<string, string | number | undefined>,
): Promise<T> {
  return client.transport.json<T>(method, `/v1/console/${path}`, {
    json: body,
    query,
  });
}
