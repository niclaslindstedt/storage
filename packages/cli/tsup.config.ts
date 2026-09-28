import { defineConfig } from "tsup";

// One self-contained file: the few server modules the CLI reuses (the QR
// encoder, default paths, the console's response types) are bundled in, so
// the package has no runtime dependencies.
export default defineConfig({
  entry: { storage: "src/bin.ts" },
  format: ["esm"],
  target: "node22",
  platform: "node",
  clean: true,
  splitting: false,
  sourcemap: true,
  removeNodeProtocol: false,
});
