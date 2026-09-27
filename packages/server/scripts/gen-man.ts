// Regenerate man/<command>.md from the CLI registry (src/cli/spec.ts).
// Run: npm run gen:man  (CI fails when the committed pages drift: tests/cli_test.ts)

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { renderMan } from "../src/cli/render.ts";
import { COMMANDS } from "../src/cli/spec.ts";

const root = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "man",
);
mkdirSync(root, { recursive: true });
for (const c of COMMANDS)
  writeFileSync(join(root, `${c.name}.md`), renderMan(c));
console.log(`wrote ${COMMANDS.length} manual pages to ${root}`);
