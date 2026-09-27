// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// What a command gets: output sinks, environment, a logger and a stop signal
// — injected so the whole CLI runs in-process under test.

import { X509Certificate, createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { ServerConfig } from "../config.ts";
import { type Ctx, createContext } from "../context.ts";
import type { Logger } from "../log.ts";
import { lanAddresses } from "../net/netinfo.ts";

export type CliIo = {
  out: (text: string) => void;
  err: (text: string) => void;
  env: NodeJS.ProcessEnv;
  log: Logger;
  /** Resolves long-running commands (serve, test-server) when aborted. */
  signal: AbortSignal;
  /** Whether stdout is a terminal (QR codes use ANSI colours only then). */
  tty: boolean;
  /** The always-on debug log file (offered for download by the console). */
  logFile?: string | null;
  /** The OS whose default paths apply (defaults to this one; tests pin it). */
  platform?: NodeJS.Platform;
};

export function openContext(config: ServerConfig, log: Logger): Ctx {
  return createContext(config, { log });
}

/** The URL devices should use, for QR payloads printed by the CLI. */
export function advertisedUrl(config: ServerConfig): string {
  if (config.publicUrl) return config.publicUrl;
  const scheme = config.tls.mode === "off" ? "http" : "https";
  const host = config.tls.domains[0] ?? lanAddresses()[0] ?? "localhost";
  return `${scheme}://${host}:${config.listen.port}`;
}

/** SPKI fingerprint of the self-signed certificate, for native pinning. */
export function selfSignedFingerprint(
  config: ServerConfig,
): string | undefined {
  if (config.tls.mode !== "self-signed" || !config.dataDir) return undefined;
  const p = join(config.dataDir, "tls", "self-signed.crt");
  if (!existsSync(p)) return undefined;
  const cert = new X509Certificate(readFileSync(p, "utf8"));
  return createHash("sha256")
    .update(cert.publicKey.export({ type: "spki", format: "der" }))
    .digest("base64url");
}
