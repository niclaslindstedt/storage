// Shared Vitest settings for the workspaces that run the real server and the
// framework client from source (no build step between an edit and a test run).

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { UserConfig } from "vitest/config";

const root = dirname(fileURLToPath(import.meta.url));

/** Where the oss-framework checkout lives (CI clones it; locally a sibling). */
export const frameworkDir = resolve(
  process.env.OSS_FRAMEWORK_DIR ?? resolve(root, "..", "oss-framework"),
);

export const sharedConfig: UserConfig = {
  plugins: [
    {
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
  resolve: {
    alias: [
      {
        find: /^@niclaslindstedt\/storage-server$/,
        replacement: resolve(root, "packages/server/src/index.ts"),
      },
      {
        find: /^@niclaslindstedt\/storage-testkit$/,
        replacement: resolve(root, "packages/testkit/src/index.ts"),
      },
      {
        find: /^@niclaslindstedt\/storage-testkit\/client$/,
        replacement: resolve(root, "packages/testkit/src/client.ts"),
      },
      {
        find: /^@niclaslindstedt\/oss-framework\/storage$/,
        replacement: resolve(frameworkDir, "src/storage/index.ts"),
      },
    ],
  },
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*_test.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
};
