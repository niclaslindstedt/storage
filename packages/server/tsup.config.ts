import { defineConfig } from "tsup";

import { esbuildUiPlugin } from "./scripts/ui-bundle.ts";

export default defineConfig({
  entry: { index: "src/index.ts", cli: "src/cli/bin.ts" },
  format: ["esm"],
  target: "node22",
  platform: "node",
  // tsup's declaration build sets `baseUrl`, which TypeScript 6 deprecates;
  // the repository's own tsconfigs do not use it.
  dts: {
    entry: { index: "src/index.ts" },
    compilerOptions: { ignoreDeprecations: "6.0" },
  },
  clean: true,
  sourcemap: true,
  splitting: true,
  loader: { ".md": "text" },
  // The admin console UI is bundled into the server (`?bundle` imports).
  esbuildPlugins: [esbuildUiPlugin()],
  // node:sqlite has no bare-name alias; keep the node: prefix on every builtin.
  removeNodeProtocol: false,
});
