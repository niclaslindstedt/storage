import { resolve } from "node:path";

import type { Plugin } from "esbuild";
import { defineConfig } from "tsup";

import { frameworkDir } from "../../vitest.shared.ts";

// The framework's self-hosted client and QR encoder are bundled from source
// (like apps/remote does): dependency-free TypeScript, so the published
// package keeps zero runtime dependencies.
const framework: Plugin = {
  name: "oss-framework-source",
  setup(build) {
    build.onResolve(
      { filter: /^@niclaslindstedt\/oss-framework\/storage\/selfhosted$/ },
      () => ({
        path: resolve(frameworkDir, "src/storage/selfhosted/index.ts"),
      }),
    );
    build.onResolve(
      { filter: /^@niclaslindstedt\/oss-framework\/qr\/(encode|svg)$/ },
      (args) => ({
        path: resolve(frameworkDir, `src/qr/${args.path.split("/").pop()}.ts`),
      }),
    );
  },
};

export default defineConfig({
  entry: { cli: "src/bin.ts", index: "src/index.ts" },
  format: ["esm"],
  target: "node22",
  platform: "node",
  clean: true,
  sourcemap: true,
  splitting: true,
  noExternal: [/^@niclaslindstedt\/oss-framework/],
  esbuildPlugins: [framework],
  banner: { js: "#!/usr/bin/env node" },
  removeNodeProtocol: false,
});
