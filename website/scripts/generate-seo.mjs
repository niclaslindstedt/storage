#!/usr/bin/env node
// Post-prerender SEO outputs, all from the same
// page list and source data the pages render from:
//   - sitemap.xml  with <lastmod> from git history (never the build time)
//   - robots.txt   Allow: / (but not the web drive app) plus an absolute Sitemap: line
//   - llms.txt     llmstxt.org index of docs, commands and examples
//   - og/<slug>.png and og-default.png — 1200×630 cards rendered from each
//     page's title and description (satori → resvg)

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { Resvg } from "@resvg/resvg-js";
import satori from "satori";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const DIST = resolve(ROOT, "dist");
const SSR_DIR = resolve(ROOT, ".ssr-build");
const require = createRequire(import.meta.url);

const { pages, SITE, source } = await import(
  pathToFileURL(resolve(SSR_DIR, "entry-server.mjs")).href
);
const all = pages();
const abs = (path) => `${SITE.url}/${path}`;

function write(rel, body) {
  const full = resolve(DIST, rel);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, body);
  console.log(`wrote ${rel}`);
}

const xml = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// lastmod: a doc's last commit; the home and docs index change with any doc
// or release, so they take the newest of those.
const newestDoc = source.docs
  .map((d) => d.modified)
  .sort()
  .at(-1);
const lastmod = (p) =>
  p.doc ? p.doc.modified : [newestDoc, source.lastUpdated].sort().at(-1);

write(
  "sitemap.xml",
  `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${all
  .map(
    (p) => `  <url>
    <loc>${xml(abs(p.path))}</loc>
    <lastmod>${lastmod(p)}</lastmod>
    <changefreq>${p.kind === "doc" ? "monthly" : "weekly"}</changefreq>
    <priority>${p.kind === "home" ? "1.0" : p.kind === "docs" ? "0.8" : "0.7"}</priority>
  </url>`,
  )
  .join("\n")}
</urlset>
`,
);

write(
  "robots.txt",
  // The web drive (dist/drive/, apps/drive) is an app, not a page.
  `User-agent: *\nAllow: /\nDisallow: /storage/drive/\n\nSitemap: ${abs(SITE.sitemap)}\n`,
);

write(
  "llms.txt",
  [
    `# ${SITE.name}`,
    "",
    `> ${SITE.description}`,
    "",
    `Current version: ${source.version}. Source: ${source.repo}`,
    "",
    "## Docs",
    "",
    ...source.docs.map(
      (d) => `- [${d.title}](${abs(`docs/${d.slug}/`)}): ${d.summary}`,
    ),
    "",
    "## Commands",
    "",
    ...source.commands.map(
      (c) =>
        `- [${source.bin} ${c.name}](${source.repo}/blob/main/man/${c.name}.md): ${c.summary}`,
    ),
    "",
    "## Examples",
    "",
    ...source.examples.map((e) => `- [${e.title}](${e.source}): ${e.summary}`),
    "",
  ].join("\n"),
);

// ---------------------------------------------------------------- OG cards

const font = (weight) =>
  readFileSync(
    require.resolve(
      `@fontsource/inter/files/inter-latin-${weight}-normal.woff`,
    ),
  );
const fonts = [
  { name: "Inter", data: font(400), weight: 400, style: "normal" },
  { name: "Inter", data: font(700), weight: 700, style: "normal" },
];

const h = (type, style, children) => ({ type, props: { style, children } });

function card({ eyebrow, title, description }) {
  return h(
    "div",
    {
      width: "100%",
      height: "100%",
      display: "flex",
      flexDirection: "column",
      justifyContent: "space-between",
      padding: "72px 80px",
      background: SITE.theme.dark,
      color: "#e8ebf4",
      fontFamily: "Inter",
      borderLeft: "16px solid #8ea2ff",
    },
    [
      h("div", { display: "flex", flexDirection: "column" }, [
        h("div", { fontSize: 30, color: "#8ea2ff", fontWeight: 700 }, eyebrow),
        h(
          "div",
          { fontSize: 64, fontWeight: 700, lineHeight: 1.1, marginTop: 28 },
          title,
        ),
        h(
          "div",
          { fontSize: 30, color: "#a3acc2", marginTop: 28, lineHeight: 1.35 },
          description,
        ),
      ]),
      h(
        "div",
        {
          display: "flex",
          justifyContent: "space-between",
          fontSize: 26,
          color: "#a3acc2",
        },
        [
          h("div", {}, SITE.url.replace(/^https:\/\//, "")),
          h("div", {}, `v${source.version} · ${SITE.author.name}`),
        ],
      ),
    ],
  );
}

async function png(node) {
  const svg = await satori(node, {
    width: SITE.og.width,
    height: SITE.og.height,
    fonts,
  });
  return new Resvg(svg, { fitTo: { mode: "width", value: SITE.og.width } })
    .render()
    .asPng();
}

const shorten = (s, n) =>
  s.length > n ? `${s.slice(0, s.lastIndexOf(" ", n))}…` : s;

for (const p of all) {
  const node = card({
    eyebrow: p.kind === "doc" ? `${SITE.name} · docs` : SITE.name,
    title:
      p.kind === "home" ? SITE.tagline : p.doc ? p.doc.title : "Documentation",
    description: shorten(p.description, 150),
  });
  write(`og/${p.slug}.png`, await png(node));
}
write(
  SITE.og.default,
  await png(
    card({
      eyebrow: SITE.name,
      title: SITE.tagline,
      description: SITE.description,
    }),
  ),
);

rmSync(SSR_DIR, { recursive: true, force: true });
