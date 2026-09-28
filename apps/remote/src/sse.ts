// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// A Server-Sent Events parser for streams read with `fetch` — the only way
// to follow an event stream that needs an Authorization header (EventSource
// cannot send one). Feed it text as it arrives; it calls back per event.

export type SseParser = { feed(chunk: string): void };

export function createSseParser(
  onEvent: (name: string, data: string) => void,
): SseParser {
  let buffer = "";
  return {
    feed(chunk) {
      buffer += chunk.replace(/\r\n?/g, "\n");
      let sep: number;
      while ((sep = buffer.indexOf("\n\n")) >= 0) {
        const block = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        let name = "message";
        const data: string[] = [];
        for (const line of block.split("\n")) {
          if (line.startsWith(":")) continue; // comment (keep-alive)
          const colon = line.indexOf(":");
          const field = colon < 0 ? line : line.slice(0, colon);
          let value = colon < 0 ? "" : line.slice(colon + 1);
          if (value.startsWith(" ")) value = value.slice(1);
          if (field === "event") name = value;
          else if (field === "data") data.push(value);
        }
        if (data.length) onEvent(name, data.join("\n"));
      }
    },
  };
}
