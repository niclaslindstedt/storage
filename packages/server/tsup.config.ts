import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts", cli: "src/cli/bin.ts" },
  format: ["esm"],
  target: "node22",
  platform: "node",
  dts: { entry: { index: "src/index.ts" } },
  clean: true,
  sourcemap: true,
  splitting: true,
  loader: { ".md": "text" },
  // node:sqlite has no bare-name alias; keep the node: prefix on every builtin.
  removeNodeProtocol: false,
});
