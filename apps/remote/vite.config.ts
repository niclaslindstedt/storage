import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const here = dirname(fileURLToPath(import.meta.url));
// The framework is consumed from source (a checkout next to this repo, or
// OSS_FRAMEWORK_DIR), like the reference app; only its dependency-free
// self-hosted client and QR encoder are used, never its React components.
const framework = resolve(
  process.env.OSS_FRAMEWORK_DIR ?? resolve(here, "../../../oss-framework"),
);
// The admin console's own pages, mounted unchanged (SPEC §11.2).
const consoleUi = resolve(here, "../../packages/server/src/admin/ui");

// The built page may talk only to storage servers and load only itself: an
// admin device's page is worth the strictest policy it can run under. (Dev
// mode injects inline styles, so the policy is added to builds only.)
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "connect-src https: http:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

export default defineConfig({
  plugins: [
    {
      name: "csp",
      apply: "build",
      transformIndexHtml: () => [
        {
          tag: "meta",
          attrs: { "http-equiv": "Content-Security-Policy", content: CSP },
          injectTo: "head-prepend",
        },
      ],
    },
  ],
  // Relative asset URLs: the native wrapper serves the build from a loopback
  // origin, the web build from wherever it is deployed.
  base: "./",
  resolve: {
    alias: [
      {
        find: /^@niclaslindstedt\/oss-framework\/storage\/selfhosted$/,
        replacement: resolve(framework, "src/storage/selfhosted/index.ts"),
      },
      {
        find: /^@niclaslindstedt\/oss-framework\/qr\/(encode|svg)$/,
        replacement: resolve(framework, "src/qr/$1.ts"),
      },
      { find: /^@storage\/console\//, replacement: `${consoleUi}/` },
    ],
  },
  build: { target: "es2022", sourcemap: false },
  server: {
    port: 4175,
    strictPort: true,
    fs: { allow: [here, framework, consoleUi] },
  },
  preview: { port: 4175, strictPort: true },
  test: {
    include: ["tests/**/*_test.ts"],
    environment: "node",
  },
});
