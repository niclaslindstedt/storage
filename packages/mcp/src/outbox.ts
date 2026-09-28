// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Secrets never enter the model's context. A pairing code, a device-adding
// QR, an invite or a new recovery key is a credential: in a transcript it
// can be logged by the model provider, echoed, or exfiltrated by a
// prompt-injected agent. Tools that mint one write it here — a private file
// (0600) for the human, with a QR code where it is a QR payload — and tell
// the model only where it is and when it expires.

import { readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

import { encodeQr } from "@niclaslindstedt/oss-framework/qr/encode";
import { qrToSvg } from "@niclaslindstedt/oss-framework/qr/svg";

import { ensurePrivateDir, writePrivate } from "./vault.ts";

const KEEP_MS = 24 * 3600_000;

export type Delivered = { file: string; qr?: string; expiresAt?: string };

export function createOutbox(dir: string, now: () => number = Date.now) {
  const box = join(dir, "outbox");
  return {
    /** Delete deliveries older than a day. */
    prune(): void {
      try {
        for (const f of readdirSync(box))
          if (now() - statSync(join(box, f)).mtimeMs > KEEP_MS)
            rmSync(join(box, f), { force: true });
      } catch {
        // no outbox yet
      }
    },
    deliver(
      kind: string,
      secret: string,
      opts: { title: string; note: string; expiresAt?: number; qr?: boolean },
    ): Delivered {
      ensurePrivateDir(box);
      const stamp = new Date(now()).toISOString().replace(/[:.]/g, "-");
      const base = join(box, `${stamp}-${kind}`);
      const expires = opts.expiresAt
        ? new Date(opts.expiresAt).toISOString()
        : undefined;
      writePrivate(
        `${base}.txt`,
        [
          opts.title,
          "",
          secret,
          "",
          opts.note,
          ...(expires ? ["", `Expires ${expires}.`] : []),
          "",
          "Written by storage-mcp for you, not for the agent. Delete this file once used.",
          "",
        ].join("\n"),
      );
      let qr: string | undefined;
      if (opts.qr) {
        qr = `${base}.svg`;
        writePrivate(qr, qrToSvg(encodeQr(secret, { ecl: "M" })));
      }
      return {
        file: `${base}.txt`,
        ...(qr ? { qr } : {}),
        ...(expires ? { expiresAt: expires } : {}),
      };
    },
  };
}

export type Outbox = ReturnType<typeof createOutbox>;
