// Regenerate man/storage/*.md from the CLI registry (src/spec.ts).
// Run: npm run gen:man  (CI fails when the committed pages drift: tests/man_test.ts)

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { renderMan, renderManIndex } from "../src/render.ts";
import { COMMANDS } from "../src/spec.ts";

const root = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "man",
  "storage",
);
mkdirSync(root, { recursive: true });
writeFileSync(join(root, "README.md"), renderManIndex());
for (const c of COMMANDS)
  writeFileSync(join(root, `${c.name}.md`), renderMan(c));
console.log(`wrote ${COMMANDS.length + 1} manual pages to ${root}`);
