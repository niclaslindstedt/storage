import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts", client: "src/client.ts" },
  format: ["esm"],
  target: "node22",
  platform: "node",
  dts: true,
  clean: true,
  sourcemap: true,
  removeNodeProtocol: false,
  external: [
    "@niclaslindstedt/storage-server",
    "@niclaslindstedt/oss-framework",
  ],
});
