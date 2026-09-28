import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const here = dirname(fileURLToPath(import.meta.url));
// The framework is consumed from source (a checkout next to this repo, or
// OSS_FRAMEWORK_DIR), like Storage Remote; only its dependency-free
// self-hosted client and QR encoder are used.
const framework = resolve(
  process.env.OSS_FRAMEWORK_DIR ?? resolve(here, "../../../oss-framework"),
);
// The console's DOM helpers and stylesheet, and Storage Remote's file
// browser, key set-up and device pages, shared unchanged.
const consoleUi = resolve(here, "../../packages/server/src/admin/ui");
const remote = resolve(here, "../remote/src");

// The page holds your keys: it may talk only to storage servers and load
// only itself. (Dev mode injects inline styles, so builds only.) A <meta>
// policy because the website is a static host that cannot send headers.
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
  // Relative asset URLs: served from the website at /storage/drive/, or
  // from wherever a hoster puts the build.
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
      { find: /^@storage\/remote\//, replacement: `${remote}/` },
    ],
  },
  build: { target: "es2022", sourcemap: false },
  server: {
    port: 4176,
    strictPort: true,
    fs: { allow: [here, framework, consoleUi, remote] },
  },
  preview: { port: 4176, strictPort: true },
  test: {
    include: ["tests/**/*_test.ts"],
    environment: "node",
  },
});
