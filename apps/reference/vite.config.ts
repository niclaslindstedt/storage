import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const here = dirname(fileURLToPath(import.meta.url));
// The framework is consumed from source (a checkout next to this repo, or
// OSS_FRAMEWORK_DIR) so the app always runs the client under test.
const framework = resolve(
  process.env.OSS_FRAMEWORK_DIR ?? resolve(here, "../../../oss-framework"),
);

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      {
        find: /^@niclaslindstedt\/oss-framework\/storage$/,
        replacement: resolve(framework, "src/storage/index.ts"),
      },
      {
        find: /^@niclaslindstedt\/oss-framework\/qr$/,
        replacement: resolve(framework, "src/qr/index.ts"),
      },
    ],
    // One React: the framework's sources must use the app's copy.
    dedupe: ["react", "react-dom"],
  },
  server: { port: 4173, strictPort: true, fs: { allow: [here, framework] } },
  preview: { port: 4173, strictPort: true },
});
