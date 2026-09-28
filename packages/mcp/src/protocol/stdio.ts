// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The MCP stdio transport: one JSON-RPC message per line on stdin/stdout,
// UTF-8, no embedded newlines. stdout carries MCP messages and nothing
// else; everything a person should read goes to stderr. A line longer than
// the limit is dropped (and answered with a parse error) instead of being
// buffered without bound.

import type { Readable, Writable } from "node:stream";

export type Channel = {
  /** Send one message (serialized on one line). */
  send(message: unknown): void;
  /** Stop reading; resolves once the input is closed. */
  close(): void;
};

export const MAX_LINE_BYTES = 16 * 1024 * 1024;

export function stdioChannel(
  input: Readable,
  output: Writable,
  onMessage: (message: unknown) => void,
  onClose: () => void,
  opts: { maxLineBytes?: number; onParseError?: () => void } = {},
): Channel {
  const max = opts.maxLineBytes ?? MAX_LINE_BYTES;
  let buffer = "";
  let dropping = false;
  input.setEncoding("utf8");

  const line = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      opts.onParseError?.();
      return;
    }
    onMessage(parsed);
  };

  input.on("data", (chunk: string) => {
    let start = 0;
    for (;;) {
      const nl = chunk.indexOf("\n", start);
      if (nl < 0) break;
      const part = chunk.slice(start, nl);
      if (dropping) dropping = false;
      else line(buffer + part);
      buffer = "";
      start = nl + 1;
    }
    if (dropping) return;
    buffer += chunk.slice(start);
    if (Buffer.byteLength(buffer) > max) {
      buffer = "";
      dropping = true;
      opts.onParseError?.();
    }
  });
  input.on("end", () => {
    if (!dropping && buffer) line(buffer);
    buffer = "";
    onClose();
  });

  return {
    send(message) {
      // JSON.stringify escapes newlines inside strings, so this is one line.
      output.write(`${JSON.stringify(message)}\n`);
    },
    close() {
      input.pause();
    },
  };
}
