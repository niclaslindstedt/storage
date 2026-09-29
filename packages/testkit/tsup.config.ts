import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts", client: "src/client.ts" },
  format: ["esm"],
  target: "node22",
  platform: "node",
  // tsup's declaration build sets `baseUrl`, which TypeScript 6 deprecates;
  // the repository's own tsconfigs do not use it.
  dts: { compilerOptions: { ignoreDeprecations: "6.0" } },
  clean: true,
  sourcemap: true,
  removeNodeProtocol: false,
  external: [
    "@niclaslindstedt/storage-server",
    "@niclaslindstedt/oss-framework",
  ],
});
