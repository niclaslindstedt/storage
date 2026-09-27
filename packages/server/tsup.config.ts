import { defineConfig } from "tsup";

import { esbuildUiPlugin } from "./scripts/ui-bundle.ts";

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
  // The admin console UI is bundled into the server (`?bundle` imports).
  esbuildPlugins: [esbuildUiPlugin()],
  // node:sqlite has no bare-name alias; keep the node: prefix on every builtin.
  removeNodeProtocol: false,
});
