// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// A local, append-only record of every tool call the agent made: which
// tool, when, how it ended, and its arguments with content replaced by a
// size and a hash. It answers "what did the agent do?" without becoming a
// second copy of the data. The storage server keeps its own tamper-evident
// audit chain of every change, under this device's id.

import { createHash } from "node:crypto";
import { appendFileSync, existsSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";

const MAX_BYTES = 5 * 1024 * 1024;
/** Argument names whose values are content, never logged as they are. */
const CONTENT = new Set([
  "content",
  "value",
  "text",
  "base64",
  "invite",
  "confirm",
]);

export function redactArgs(
  args: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    if (CONTENT.has(k)) {
      const s = typeof v === "string" ? v : JSON.stringify(v ?? null);
      out[k] = {
        bytes: Buffer.byteLength(s),
        sha256: createHash("sha256").update(s).digest("hex").slice(0, 16),
      };
    } else out[k] = v;
  }
  return out;
}

export function createAuditLog(dir: string, now: () => number = Date.now) {
  const file = join(dir, "audit.log");
  return (event: {
    tool: string;
    args: Record<string, unknown>;
    outcome: string;
    ms: number;
  }) => {
    try {
      if (existsSync(file) && statSync(file).size > MAX_BYTES)
        renameSync(file, `${file}.1`);
      appendFileSync(
        file,
        `${JSON.stringify({
          at: new Date(now()).toISOString(),
          tool: event.tool,
          outcome: event.outcome,
          ms: event.ms,
          args: redactArgs(event.args),
        })}\n`,
        { mode: 0o600 },
      );
    } catch {
      // The audit log must never take the server down.
    }
  };
}
