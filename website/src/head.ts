// Per-route <head>, rendered at build time by the
// prerenderer. Every value comes from src/site.ts and the extracted source
// data, so each page describes itself: its own title, description,
// canonical URL, Open Graph / Twitter card and JSON-LD graph.

import { source } from "./generated/sourceData";
import { abs, SITE, type Page } from "./site";

const esc = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

const meta = (attr: "name" | "property", key: string, value: string) =>
  `<meta ${attr}="${key}" content="${esc(value)}" />`;

const AUTHOR_ID = `${SITE.url}/#author`;
const WEBSITE_ID = `${SITE.url}/#website`;

const person = {
  "@type": "Person",
  "@id": AUTHOR_ID,
  name: SITE.author.name,
  url: SITE.author.url,
  sameAs: SITE.author.sameAs,
};

const image = (page: Page) => ({
  "@type": "ImageObject",
  url: page.ogImage,
  width: SITE.og.width,
  height: SITE.og.height,
});

function breadcrumbs(page: Page) {
  const items = [
    { name: SITE.name, item: abs("") },
    { name: "Documentation", item: abs("docs/") },
  ];
  if (page.doc) items.push({ name: page.doc.title, item: abs(page.path) });
  return {
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({
      "@type": "ListItem",
      position: i + 1,
      ...it,
    })),
  };
}

function jsonLd(page: Page): object[] {
  if (page.kind === "home") {
    return [
      person,
      {
        "@type": "WebSite",
        "@id": WEBSITE_ID,
        url: abs(""),
        name: SITE.name,
        description: SITE.description,
        inLanguage: SITE.lang,
        author: { "@id": AUTHOR_ID },
      },
      {
        "@type": "SoftwareApplication",
        "@id": `${SITE.url}/#app`,
        name: `${SITE.name} (${source.bin})`,
        url: abs(""),
        description: SITE.description,
        image: image(page),
        applicationCategory: "DeveloperApplication",
        operatingSystem: "Linux, macOS, Docker",
        softwareVersion: source.version,
        softwareRequirements: `Node.js ${source.node}+ or Docker`,
        codeRepository: source.repo,
        license: `https://spdx.org/licenses/${source.license}.html`,
        author: { "@id": AUTHOR_ID },
        offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
      },
    ];
  }
  if (page.kind === "docs") {
    return [
      {
        "@type": "CollectionPage",
        "@id": abs(page.path),
        url: abs(page.path),
        name: page.title,
        description: page.description,
        inLanguage: SITE.lang,
        isPartOf: { "@id": WEBSITE_ID },
        hasPart: source.docs.map((d) => ({
          "@type": "TechArticle",
          headline: d.title,
          url: abs(`docs/${d.slug}/`),
        })),
      },
      breadcrumbs(page),
    ];
  }
  const doc = page.doc!;
  return [
    {
      "@type": "TechArticle",
      "@id": abs(page.path),
      headline: doc.title,
      description: page.description,
      image: image(page),
      datePublished: doc.published,
      dateModified: doc.modified,
      author: person,
      publisher: { "@id": AUTHOR_ID },
      wordCount: doc.wordCount,
      keywords: SITE.keywords.join(", "),
      inLanguage: SITE.lang,
      mainEntityOfPage: abs(page.path),
      isPartOf: { "@id": WEBSITE_ID },
    },
    breadcrumbs(page),
  ];
}

export function headHtml(page: Page, options: { notFound?: boolean } = {}) {
  const url = abs(page.path);
  const ogType = page.kind === "doc" ? "article" : "website";
  const graph = { "@context": "https://schema.org", "@graph": jsonLd(page) };
  const lines = [
    `<meta charset="utf-8" />`,
    `<meta name="viewport" content="width=device-width, initial-scale=1" />`,
    `<title>${esc(page.title)}</title>`,
    meta("name", "description", page.description),
    meta("name", "keywords", SITE.keywords.join(", ")),
    meta("name", "author", SITE.author.name),
    meta(
      "name",
      "robots",
      options.notFound
        ? "noindex,follow"
        : "index,follow,max-image-preview:large",
    ),
    meta("name", "referrer", "strict-origin-when-cross-origin"),
    `<meta name="theme-color" media="(prefers-color-scheme: light)" content="${SITE.theme.light}" />`,
    `<meta name="theme-color" media="(prefers-color-scheme: dark)" content="${SITE.theme.dark}" />`,
    `<meta name="color-scheme" content="light dark" />`,
    `<link rel="canonical" href="${url}" />`,
    `<link rel="sitemap" type="application/xml" href="${SITE.base}${SITE.sitemap}" />`,
    `<link rel="icon" type="image/svg+xml" href="${SITE.base}favicon.svg" />`,
    meta("property", "og:site_name", SITE.name),
    meta("property", "og:locale", SITE.locale),
    meta("property", "og:type", ogType),
    meta("property", "og:title", page.title),
    meta("property", "og:description", page.description),
    meta("property", "og:url", url),
    meta("property", "og:image", page.ogImage),
    meta("property", "og:image:width", String(SITE.og.width)),
    meta("property", "og:image:height", String(SITE.og.height)),
    meta("property", "og:image:alt", page.ogAlt),
    ...(page.doc
      ? [
          meta("property", "article:published_time", page.doc.published),
          meta("property", "article:modified_time", page.doc.modified),
          meta("property", "article:author", SITE.author.url),
          ...SITE.keywords
            .slice(0, 4)
            .map((k) => meta("property", "article:tag", k)),
        ]
      : []),
    meta("name", "twitter:card", "summary_large_image"),
    meta("name", "twitter:title", page.title),
    meta("name", "twitter:description", page.description),
    meta("name", "twitter:image", page.ogImage),
    meta("name", "twitter:image:alt", page.ogAlt),
  ];
  if (!options.notFound)
    lines.push(
      `<script type="application/ld+json">${JSON.stringify(graph).replace(/</g, "\\u003c")}</script>`,
    );
  return lines.join("\n    ");
}
