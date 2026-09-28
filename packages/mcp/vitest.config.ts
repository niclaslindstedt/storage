import { resolve } from "node:path";

import { defineConfig } from "vitest/config";

import { frameworkDir, sharedConfig } from "../../vitest.shared.ts";

const shared = sharedConfig.resolve!.alias as {
  find: RegExp;
  replacement: string;
}[];

export default defineConfig({
  ...sharedConfig,
  resolve: {
    alias: [
      ...shared,
      {
        find: /^@niclaslindstedt\/oss-framework\/storage\/selfhosted$/,
        replacement: resolve(frameworkDir, "src/storage/selfhosted/index.ts"),
      },
      {
        find: /^@niclaslindstedt\/oss-framework\/qr\/(encode|svg)$/,
        replacement: resolve(frameworkDir, "src/qr/$1.ts"),
      },
    ],
  },
});
