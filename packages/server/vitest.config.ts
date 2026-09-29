import { readFileSync } from "node:fs";

import { defineConfig } from "vitest/config";

import { viteUiPlugin } from "./scripts/ui-bundle.ts";

export default defineConfig({
  plugins: [
    viteUiPlugin(),
    {
      // Inline Markdown as a string, as the tsup "text" loader does in the build.
      name: "markdown-as-text",
      transform(_code, id) {
        if (!id.endsWith(".md")) return null;
        return {
          code: `export default ${JSON.stringify(readFileSync(id, "utf8"))};`,
          map: null,
        };
      },
    },
  ],
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*_test.ts"],
    // node:sqlite prints a one-time ExperimentalWarning per worker; silence it.
    execArgv: ["--disable-warning=ExperimentalWarning"],
    testTimeout: 20_000,
  },
});
