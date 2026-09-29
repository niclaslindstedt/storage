#!/usr/bin/env node
// Structural SEO check. Walks every HTML file under `dist/`
// after the build and asserts the signals Search Console, social-card
// unfurlers, and AI crawlers actually read. Failures emit GitHub
// Actions `::error::` annotations so the line surfaces inline on the
// PR file view; the script exits non-zero if anything fails.
//
// Run locally with `npm run check:seo` after a build, or wire into CI
// after `npm run build`. The point of this script is to make the
// failure modes that matter (empty SSR body, missing canonical,
// JSON-LD that doesn't parse, BlogPosting.image drift from og:image,
// sitemap.xml that drops a route, a page only the sitemap links to)
// impossible to ship silently. It also walks JSON-LD `@graph` arrays and
// the internal link graph.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST = resolve(__dirname, "../dist");
const SITE_URL = "https://niclaslindstedt.github.io/storage";
const BASE = "/storage/";

const findings = [];
const err = (file, message) => findings.push({ level: "error", file, message });
const warn = (file, message) =>
  findings.push({ level: "warning", file, message });

// Apps built into dist/ beside the pages (not prerendered, `noindex`,
// kept out of the sitemap by robots.txt): the web drive, apps/drive.
const APP_DIRS = new Set([join(DIST, "drive")]);

function walkHtml(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory() && APP_DIRS.has(full)) continue;
    if (entry.isDirectory()) out.push(...walkHtml(full));
    else if (entry.isFile() && entry.name.endsWith(".html")) out.push(full);
  }
  return out;
}

const textOf = (html) => html.replace(/<[^>]+>/g, " ");
const bodyOf = (html) => {
  const m = html.match(/<body[^>]*>([\s\S]*?)<\/body>/);
  return m ? m[1] : null;
};
const attr = (html, re) => {
  const m = html.match(re);
  return m ? m[1] : null;
};

function checkHtmlFile(file) {
  const rel = relative(DIST, file).replace(/\\/g, "/");
  const html = readFileSync(file, "utf8");
  const is404 = rel === "404.html";

  // A prerendered body must contain substantive content.
  const body = bodyOf(html);
  if (!body) {
    err(rel, "no <body> tag");
  } else {
    const words = textOf(body).split(/\s+/).filter(Boolean).length;
    if (words < 20)
      err(
        rel,
        `<body> has only ${words} words — looks like an empty SPA shell`,
      );
  }

  // Exactly one <h1>, no skipped heading levels.
  const h1Count = (body ?? html).match(/<h1[\s>]/g)?.length ?? 0;
  if (!/<html[^>]*\blang="[a-z-]+"/i.test(html))
    err(rel, "missing <html lang>");
  if (!/<meta\s+name="referrer"/.test(html))
    err(rel, "missing referrer policy");
  if ((html.match(/<meta name="theme-color" media=/g) ?? []).length < 2)
    err(rel, "missing light/dark theme-color variants");
  if (!is404) {
    for (const key of [
      "twitter:card",
      "twitter:image",
      "twitter:image:alt",
      "og:image:alt",
    ])
      if (!html.includes(`"${key}"`)) err(rel, `missing ${key}`);
    if (!html.includes("application/ld+json")) err(rel, "missing JSON-LD");
  }
  if (h1Count === 0) err(rel, "missing <h1>");
  else if (h1Count > 1)
    warn(rel, `${h1Count} <h1> tags — only one should describe the page topic`);
  if (body) {
    const seen = new Set();
    for (const m of body.matchAll(/<h([1-6])[\s>]/g)) seen.add(Number(m[1]));
    const levels = [...seen].sort((a, b) => a - b);
    for (let i = 1; i < levels.length; i++) {
      if (levels[i] - levels[i - 1] > 1) {
        warn(
          rel,
          `heading levels skip from h${levels[i - 1]} to h${levels[i]} — Lighthouse / a11y flag`,
        );
        break;
      }
    }
  }

  // <title>, meta description, canonical, robots.
  const title = attr(html, /<title>([^<]*)<\/title>/);
  if (!title || !title.trim()) err(rel, "missing or empty <title>");
  else if (title.length > 70)
    warn(rel, `<title> is ${title.length} chars — Google truncates around 60`);

  const desc = attr(html, /<meta\s+name="description"\s+content="([^"]*)"/);
  if (!desc || !desc.trim()) err(rel, "missing or empty meta description");
  else if (desc.length > 160)
    warn(
      rel,
      `meta description is ${desc.length} chars — Google truncates around 160`,
    );

  const canonical = attr(html, /<link\s+rel="canonical"\s+href="([^"]+)"/);
  if (!canonical) err(rel, "missing canonical link");
  else if (!canonical.startsWith(SITE_URL))
    err(rel, `canonical \`${canonical}\` is not absolute under ${SITE_URL}`);

  const robots = attr(html, /<meta\s+name="robots"\s+content="([^"]+)"/);
  if (!robots) err(rel, "missing robots meta");
  else if (is404) {
    if (!/\bnoindex\b/.test(robots)) err(rel, "404.html must have noindex");
  } else if (/\bnoindex\b/.test(robots))
    err(rel, `real page has \`noindex\` (\`${robots}\`) — it won't be indexed`);

  // og:image must resolve to a real file; if a
  // JSON-LD block carries an Article-shaped image, it must match.
  const ogImage = attr(html, /<meta\s+property="og:image"\s+content="([^"]+)"/);
  if (!ogImage) {
    err(rel, "missing og:image");
  } else if (ogImage.startsWith(`${SITE_URL}/`)) {
    const local = join(DIST, ogImage.slice(SITE_URL.length + 1));
    if (!existsSync(local))
      err(rel, `og:image \`${ogImage}\` doesn't exist in dist/`);
  }

  const jsonLdBlocks = [
    ...html.matchAll(/<script type="application\/ld\+json">([^<]+)<\/script>/g),
  ];
  for (const block of jsonLdBlocks) {
    const raw = block[1].replace(/\\u003c/g, "<");
    let data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      err(rel, `JSON-LD block doesn't parse: ${e.message}`);
      continue;
    }
    const top = Array.isArray(data) ? data : [data];
    const items = top.flatMap((d) =>
      Array.isArray(d?.["@graph"]) ? d["@graph"] : [d],
    );
    for (const item of items)
      if (!item || typeof item !== "object" || !item["@type"])
        err(rel, "JSON-LD item without @type");
    for (const item of items) {
      const type = item && typeof item === "object" ? item["@type"] : undefined;
      if (
        type === "BlogPosting" ||
        type === "TechArticle" ||
        type === "Article"
      ) {
        const rawImg = item.image;
        const imageUrl =
          typeof rawImg === "string"
            ? rawImg
            : rawImg &&
                typeof rawImg === "object" &&
                typeof rawImg.url === "string"
              ? rawImg.url
              : undefined;
        if (imageUrl && ogImage && imageUrl !== ogImage)
          err(
            rel,
            `${type} JSON-LD image \`${imageUrl}\` doesn't match og:image \`${ogImage}\``,
          );
      }
    }
  }

  // Every <img> needs alt + width + height + loading.
  if (body) {
    for (const img of body.match(/<img\b[^>]*>/g) ?? []) {
      const altMatch = img.match(/\balt="([^"]*)"/);
      if (!altMatch) err(rel, `<img> without alt: ${img.slice(0, 80)}…`);
      if (!/\bwidth="/.test(img) || !/\bheight="/.test(img))
        warn(
          rel,
          `<img> missing width/height (layout shift risk): ${img.slice(0, 80)}…`,
        );
      if (!/\bloading="/.test(img))
        warn(rel, `<img> without loading attribute: ${img.slice(0, 80)}…`);
    }
  }
}

function checkSitemap(htmlFiles) {
  const sitemapPath = join(DIST, "sitemap.xml");
  if (!existsSync(sitemapPath)) {
    err("sitemap.xml", "sitemap.xml is missing");
    return;
  }
  const sitemap = readFileSync(sitemapPath, "utf8");
  for (const file of htmlFiles) {
    const rel = relative(DIST, file).replace(/\\/g, "/");
    if (rel === "404.html") continue;
    const slug =
      rel === "index.html" ? "/" : `/${rel.replace(/\/index\.html$/, "/")}`;
    const loc = `${SITE_URL}${slug}`;
    if (!sitemap.includes(`<loc>${loc}</loc>`))
      err("sitemap.xml", `missing entry for ${loc}`);
  }
}

function checkRobotsTxt() {
  const robotsPath = join(DIST, "robots.txt");
  if (!existsSync(robotsPath)) {
    err("robots.txt", "robots.txt is missing");
    return;
  }
  const robots = readFileSync(robotsPath, "utf8");
  if (!/Sitemap:\s*https?:\/\//i.test(robots))
    err("robots.txt", "missing `Sitemap:` line pointing at sitemap.xml");
  if (/Disallow:\s*\/\s*$/m.test(robots))
    err("robots.txt", "`Disallow: /` blocks the entire site from indexing");
}

function checkLlmsTxt() {
  const llmsPath = join(DIST, "llms.txt");
  if (!existsSync(llmsPath)) {
    err("llms.txt", "llms.txt is missing");
    return;
  }
  const llms = readFileSync(llmsPath, "utf8");
  if (!/^#\s+\S/m.test(llms))
    err("llms.txt", "missing top-level `# Site title` heading");
}

function checkBundleBudgets() {
  // Critical-path JS budget. Anything the entry HTML preloads
  // counts as critical; lazy chunks reached through a runtime import()
  // do not.
  const BUDGET_BYTES = 600_000;
  const assetsDir = join(DIST, "assets");
  if (!existsSync(assetsDir)) return;
  const indexHtml = join(DIST, "index.html");
  if (!existsSync(indexHtml)) return;
  const html = readFileSync(indexHtml, "utf8");
  const critical = new Set();
  for (const m of html.matchAll(
    /<(?:script[^>]*src|link[^>]*href)="(\/storage\/assets\/[^"]+\.js)"/g,
  )) {
    critical.add(m[1].slice(BASE.length - 1));
  }
  let total = 0;
  let gzipped = 0;
  for (const url of critical) {
    const file = join(DIST, url.replace(/^\//, ""));
    if (!existsSync(file)) continue;
    total += statSync(file).size;
    gzipped += gzipSync(readFileSync(file)).length;
  }
  if (gzipped > 175_000)
    err(
      "dist/assets",
      `critical-path JS is ${(gzipped / 1024).toFixed(1)} KB gzipped — exceeds the 175 KB budget`,
    );
  if (total > BUDGET_BYTES) {
    err(
      "dist/assets",
      `critical-path JS is ${(total / 1024).toFixed(1)} KB across ${critical.size} chunk(s) — exceeds ${(BUDGET_BYTES / 1024).toFixed(0)} KB budget`,
    );
  }
}

// Every sitemap URL must be reachable from the homepage through
// static <a href> links in the prerendered HTML.
function checkLinkGraph() {
  const sitemapPath = join(DIST, "sitemap.xml");
  if (!existsSync(sitemapPath)) return;
  const locs = [
    ...readFileSync(sitemapPath, "utf8").matchAll(/<loc>([^<]+)<\/loc>/g),
  ].map((m) => m[1]);
  const seen = new Set([`${SITE_URL}/`]);
  const queue = [`${SITE_URL}/`];
  while (queue.length) {
    const url = queue.shift();
    const file = join(DIST, url.slice(SITE_URL.length + 1), "index.html");
    if (!existsSync(file)) continue;
    const body = bodyOf(readFileSync(file, "utf8")) ?? "";
    for (const m of body.matchAll(/<a\b[^>]*\bhref="([^"#]*)(?:#[^"]*)?"/g)) {
      const href = m[1];
      if (!href.startsWith(BASE)) continue;
      const next = `${SITE_URL}/${href.slice(BASE.length)}`;
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  for (const loc of locs)
    if (!seen.has(loc))
      err(
        "sitemap.xml",
        `${loc} is orphaned — no static link reaches it from the homepage`,
      );
}

function main() {
  if (!existsSync(DIST)) {
    process.stderr.write(
      "check-seo: dist/ is missing — run `npm run build` first\n",
    );
    process.exit(1);
  }

  const htmlFiles = walkHtml(DIST);
  if (htmlFiles.length === 0) err("dist/", "no HTML files found");
  for (const file of htmlFiles) checkHtmlFile(file);

  checkSitemap(htmlFiles);
  checkRobotsTxt();
  checkLlmsTxt();
  checkBundleBudgets();
  checkLinkGraph();

  const errors = findings.filter((f) => f.level === "error");
  const warnings = findings.filter((f) => f.level === "warning");

  for (const f of findings) {
    const prefix = f.level === "error" ? "::error" : "::warning";
    process.stdout.write(
      `${prefix} file=website/dist/${f.file}::${f.message}\n`,
    );
  }
  process.stdout.write(
    `check-seo: ${htmlFiles.length} page(s) checked — ${errors.length} error(s), ${warnings.length} warning(s)\n`,
  );
  if (errors.length > 0) process.exit(1);
}

main();
