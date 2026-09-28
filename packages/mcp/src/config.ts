// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Where the MCP server keeps its state, and the local policy: which tools
// this agent is offered at all. Two layers decide what an agent can do:
//
// 1. The device's scope, granted at the machine when it was paired and
//    enforced by the storage server on every request (SPEC §11.4). It
//    cannot be widened from here — or from anywhere but a new pairing.
// 2. This policy (config.json and flags): switch groups of tools off, cap
//    them at read-only, deny single tools, limit apps or folders. It can
//    only take away from what the scope grants, and it decides what the
//    model is shown at all, so disabled tools are not even listed.
//
// Layer 2 lives on the agent's machine, where an agent with a shell could
// edit it; layer 1 is the boundary that holds when that happens.

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { assertPrivate } from "./vault.ts";

export const GROUPS = [
  "server",
  "logs",
  "admin",
  "files",
  "records",
  "sharing",
  "devices",
] as const;
export type Group = (typeof GROUPS)[number];
export type Level = "off" | "read" | "write";
const LEVELS: Level[] = ["off", "read", "write"];

export const GROUP_INFO: Record<Group, string> = {
  server:
    "server health, checks, traffic, configuration, accounts, devices and namespaces as the admin console shows them (admin devices)",
  logs: "the server's log and the audit log (admin devices)",
  admin:
    "change the server: accounts, device revocation, pairing codes, maintenance actions (admin devices)",
  files: "the encrypted drive: folders and files, versions, trash",
  records: "rows (records) in any app's namespaces, e.g. meds or notes data",
  sharing: "members and invites of shared folders, joining, key rotation",
  devices:
    "this account's devices: approvals, adding a device, revoking, the recovery key",
};

export type Limits = {
  /** Tool calls per minute (token bucket), and the burst allowed. */
  callsPerMinute: number;
  burst: number;
  maxConcurrent: number;
  /** Largest file content returned to the model by one read. */
  maxReadBytes: number;
  /** Largest file the agent may write in one call. */
  maxWriteBytes: number;
  /** Most entries one listing returns. */
  maxListEntries: number;
};

export type McpConfig = {
  groups: Record<Group, Level>;
  /** Tools never offered (by name). */
  deny: string[];
  /** When set, only these tools (and groups) are offered. */
  allow: string[] | null;
  /** When set, only namespaces of these apps are touched (on top of the scope). */
  apps: string[] | null;
  /** When set, only these namespace ids are touched. */
  folders: string[] | null;
  /**
   * `require`: actions marked for confirmation ask the human through the
   * client (MCP elicitation) and are refused when the client cannot ask.
   * `host`: rely on the client's own per-call approval prompt instead.
   */
  confirm: "require" | "host";
  /** `outbox`: secrets go to a private file for the human; `off`: tools that mint them are not offered. */
  secrets: "outbox" | "off";
  limits: Limits;
  /** Keep a local audit log of every tool call. */
  audit: boolean;
  /** Serve with an ordinary, unscoped device (not recommended). */
  allowUnscoped: boolean;
  /** Allow plain HTTP to a non-loopback server (tests only). */
  allowInsecureHttp: boolean;
};

export const DEFAULT_LIMITS: Limits = {
  callsPerMinute: 60,
  burst: 20,
  maxConcurrent: 4,
  maxReadBytes: 256 * 1024,
  maxWriteBytes: 10 * 1024 * 1024,
  maxListEntries: 500,
};

export function defaultConfig(): McpConfig {
  return {
    // Everything the device's scope grants; the scope is the real limit.
    groups: Object.fromEntries(GROUPS.map((g) => [g, "write"])) as Record<
      Group,
      Level
    >,
    deny: [],
    allow: null,
    apps: null,
    folders: null,
    confirm: "require",
    secrets: "outbox",
    limits: { ...DEFAULT_LIMITS },
    audit: true,
    allowUnscoped: false,
    allowInsecureHttp: false,
  };
}

export class ConfigError extends Error {}

/** The base directory: $STORAGE_MCP_HOME, else $XDG_CONFIG_HOME/storage-mcp. */
export function baseDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.STORAGE_MCP_HOME) return env.STORAGE_MCP_HOME;
  const xdg = env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(xdg, "storage-mcp");
}

const PROFILE = /^[a-z0-9][a-z0-9-]{0,31}$/;

/** One directory per paired server/device ("profile"). */
export function profileDir(base: string, profile = "default"): string {
  if (!PROFILE.test(profile))
    throw new ConfigError("a profile name is [a-z0-9-], up to 32 characters");
  return join(base, profile);
}

const APP = /^[a-z0-9][a-z0-9-]{0,31}$/;
const NS = /^ns_[A-Za-z0-9_-]{22}$/;
const TOOL = /^[a-z][a-z0-9_]{0,63}$/;

function list(v: unknown, what: string, pattern: RegExp): string[] {
  if (!Array.isArray(v) || v.length > 200)
    throw new ConfigError(`${what} must be a list`);
  return v.map((x) => {
    if (typeof x !== "string" || !pattern.test(x))
      throw new ConfigError(`${what}: invalid entry ${JSON.stringify(x)}`);
    return x;
  });
}

/** Parse config.json strictly: unknown keys are mistakes, not extensions. */
export function parseConfig(raw: unknown): McpConfig {
  const c = defaultConfig();
  if (typeof raw !== "object" || raw === null || Array.isArray(raw))
    throw new ConfigError("config.json must be an object");
  for (const [k, v] of Object.entries(raw)) {
    switch (k) {
      case "$schema":
        break;
      case "groups": {
        if (typeof v !== "object" || v === null)
          throw new ConfigError("groups must be an object");
        for (const [g, level] of Object.entries(v)) {
          if (!GROUPS.includes(g as Group))
            throw new ConfigError(
              `groups.${g}: unknown group (one of ${GROUPS.join(", ")})`,
            );
          const l = level === true ? "write" : level === false ? "off" : level;
          if (!LEVELS.includes(l as Level))
            throw new ConfigError(`groups.${g} must be off, read or write`);
          c.groups[g as Group] = l as Level;
        }
        break;
      }
      case "deny":
        c.deny = list(v, "deny", TOOL);
        break;
      case "allow":
        c.allow = v === null ? null : list(v, "allow", TOOL);
        break;
      case "apps":
        c.apps = v === null ? null : list(v, "apps", APP);
        break;
      case "folders":
        c.folders = v === null ? null : list(v, "folders", NS);
        break;
      case "confirm":
        if (v !== "require" && v !== "host")
          throw new ConfigError("confirm must be require or host");
        c.confirm = v;
        break;
      case "secrets":
        if (v !== "outbox" && v !== "off")
          throw new ConfigError("secrets must be outbox or off");
        c.secrets = v;
        break;
      case "limits": {
        if (typeof v !== "object" || v === null)
          throw new ConfigError("limits must be an object");
        for (const [name, n] of Object.entries(v)) {
          if (!(name in DEFAULT_LIMITS))
            throw new ConfigError(`limits.${name}: unknown limit`);
          if (!Number.isSafeInteger(n) || (n as number) < 1)
            throw new ConfigError(`limits.${name} must be a positive integer`);
          c.limits[name as keyof Limits] = n as number;
        }
        break;
      }
      case "audit":
      case "allowUnscoped":
      case "allowInsecureHttp":
        if (typeof v !== "boolean")
          throw new ConfigError(`${k} must be true or false`);
        c[k] = v;
        break;
      default:
        throw new ConfigError(`config.json: unknown key ${JSON.stringify(k)}`);
    }
  }
  return c;
}

export function loadConfig(dir: string): McpConfig {
  const file = join(dir, "config.json");
  if (!existsSync(file)) return defaultConfig();
  // Someone else able to edit the policy could widen it up to the scope.
  assertPrivate(file);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    throw new ConfigError(`${file} is not valid JSON`);
  }
  return parseConfig(raw);
}

/** Flags on `serve` narrow the file's policy further. */
export type PolicyFlags = {
  readOnly?: boolean;
  disable?: string[];
  only?: string[];
  apps?: string[];
  folders?: string[];
  confirm?: "require" | "host";
};

export function applyFlags(c: McpConfig, f: PolicyFlags): McpConfig {
  const out = structuredClone(c);
  if (f.readOnly)
    for (const g of GROUPS)
      if (out.groups[g] === "write") out.groups[g] = "read";
  for (const name of f.disable ?? []) {
    if (GROUPS.includes(name as Group)) out.groups[name as Group] = "off";
    else out.deny.push(name);
  }
  if (f.only) out.allow = [...(out.allow ?? []), ...f.only];
  if (f.apps)
    out.apps = out.apps ? out.apps.filter((a) => f.apps!.includes(a)) : f.apps;
  if (f.folders)
    out.folders = out.folders
      ? out.folders.filter((a) => f.folders!.includes(a))
      : f.folders;
  if (f.confirm === "require") out.confirm = "require";
  return out;
}
