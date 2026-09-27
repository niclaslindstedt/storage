#!/usr/bin/env node
// §11.3.1 — prerender every route. Builds an SSR bundle of
// src/entry-server.tsx, renders each page from src/site.ts into
// dist/<path>/index.html with its own <head>, and writes dist/404.html
// (noindex). The client hydrates over the result.
//
// The SSR bundle is left in .ssr-build/ for generate-seo.mjs, which reads
// the same page list for the sitemap, llms.txt and OG images, then deletes it.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build } from "vite";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const DIST = resolve(ROOT, "dist");
const SSR_DIR = resolve(ROOT, ".ssr-build");

await build({
  root: ROOT,
  configFile: resolve(ROOT, "vite.config.ts"),
  logLevel: "warn",
  build: {
    ssr: resolve(ROOT, "src/entry-server.tsx"),
    outDir: SSR_DIR,
    emptyOutDir: true,
    rollupOptions: {
      output: { format: "esm", entryFileNames: "entry-server.mjs" },
    },
  },
});

const ssr = await import(
  pathToFileURL(resolve(SSR_DIR, "entry-server.mjs")).href
);
const template = readFileSync(resolve(DIST, "index.html"), "utf8");
if (
  !template.includes("<!--head-->") ||
  !template.includes('<div id="root"></div>')
)
  throw new Error("prerender: index.html lost its <!--head--> or #root marker");

function page(pageDef, options) {
  const { html, head } = ssr.render(pageDef, options);
  return template
    .replace("<!--head-->", head)
    .replace('<div id="root"></div>', `<div id="root">${html}</div>`);
}

for (const p of ssr.pages()) {
  const out = resolve(DIST, p.path, "index.html");
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, page(p));
  console.log(`prerendered /${p.path}`);
}
writeFileSync(
  resolve(DIST, "404.html"),
  page(ssr.pages()[0], { notFound: true }),
);
console.log("prerendered 404.html (noindex)");
