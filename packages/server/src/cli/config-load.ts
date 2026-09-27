// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Resolve a server configuration: flags > environment (`STORAGE_*`) >
// `<data-dir>/config.json` > defaults. Which flag sets which key, and which
// environment variable backs it, is declared once in `spec.ts`.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  type ConfigOverrides,
  resolveConfig,
  type ServerConfig,
} from "../config.ts";
import { UsageError } from "./args.ts";
import { defaultDataDir } from "./paths.ts";
import { type FlagSpec, GLOBAL_FLAGS, SERVER_FLAGS } from "./spec.ts";

type Flags = Record<string, unknown>;

function setPath(
  obj: Record<string, unknown>,
  path: string,
  value: unknown,
): void {
  const [head, ...rest] = path.split(".");
  if (rest.length === 0) {
    obj[head!] = value;
    return;
  }
  const child = (obj[head!] ??= {}) as Record<string, unknown>;
  setPath(child, rest.join("."), value);
}

function fromEnv(spec: FlagSpec, raw: string): unknown {
  switch (spec.type) {
    case "bool":
      return ["1", "true", "yes", "on"].includes(raw.toLowerCase());
    case "int":
      if (!/^-?\d+$/.test(raw))
        throw new UsageError(`${spec.env} must be an integer`);
      return Number(raw);
    case "list":
      return raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    default:
      return raw;
  }
}

function normalize(key: string, value: unknown): unknown {
  if (key === "listen.adminPort" && value === -1) return null;
  if (
    key === "tls.mode" &&
    !["acme", "files", "self-signed", "off"].includes(String(value))
  ) {
    throw new UsageError("--tls must be acme, files, self-signed or off");
  }
  if (key === "cors.mode" && !["paired", "any"].includes(String(value))) {
    throw new UsageError("--cors must be paired or any");
  }
  return value;
}

export function loadServerConfig(
  flags: Flags,
  env: NodeJS.ProcessEnv = process.env,
  os?: NodeJS.Platform,
): ServerConfig {
  const dataDir =
    (flags["data-dir"] as string | undefined) ?? defaultDataDir(env, os);
  let file: ConfigOverrides = {};
  const configPath = join(dataDir, "config.json");
  if (existsSync(configPath)) {
    try {
      file = JSON.parse(readFileSync(configPath, "utf8")) as ConfigOverrides;
    } catch (err) {
      throw new UsageError(
        `${configPath} is not valid JSON: ${(err as Error).message}`,
      );
    }
  }
  const envLayer: Record<string, unknown> = {};
  const flagLayer: Record<string, unknown> = {};
  for (const spec of [...GLOBAL_FLAGS, ...SERVER_FLAGS]) {
    if (!spec.config || spec.name === "data-dir") continue;
    const raw = spec.env ? env[spec.env] : undefined;
    if (raw !== undefined && raw !== "")
      setPath(
        envLayer,
        spec.config,
        normalize(spec.config, fromEnv(spec, raw)),
      );
    if (flags[spec.name] !== undefined)
      setPath(flagLayer, spec.config, normalize(spec.config, flags[spec.name]));
  }
  const merged = resolveConfig(
    file,
    envLayer as ConfigOverrides,
    flagLayer as ConfigOverrides,
    { dataDir },
  );
  // With TLS off the server sits behind a proxy: listen on loopback unless told otherwise.
  const hostGiven =
    flags.host !== undefined ||
    env.STORAGE_HOST ||
    (file.listen as { host?: string } | undefined)?.host;
  if (merged.tls.mode === "off" && !hostGiven) merged.listen.host = "127.0.0.1";
  return merged;
}
