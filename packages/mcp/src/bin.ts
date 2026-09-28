// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The `storage-mcp` executable.

import { main } from "./cli.ts";

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  },
);
