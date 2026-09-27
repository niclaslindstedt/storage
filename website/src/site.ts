// The single SEO/site configuration module (OSS_SPEC §11.3.2): site name,
// pitch, canonical URL, author, colours and the page list. The client, the
// prerenderer and the SEO/OG generators all import it, so changing the
// site's pitch is a one-file edit.

import { source } from "./generated/sourceData";
import type { Doc } from "./types";

export const SITE = {
  url: "https://niclaslindstedt.github.io/storage",
  base: "/storage/",
  name: "storage",
  title: "storage — self-hosted, end-to-end encrypted storage",
  tagline: "Your server. Your keys. Nobody else can read it.",
  description:
    "Self-hosted storage for local-first apps: end-to-end encrypted, row-level sync and merge, per-namespace sharing, QR pairing and easy home hosting.",
  keywords: [
    "self-hosted",
    "end-to-end encryption",
    "zero-knowledge",
    "local-first",
    "sync",
    "conflict resolution",
    "health data",
    "home server",
    "Dropbox alternative",
    "iCloud alternative",
  ],
  lang: "en",
  locale: "en_US",
  author: {
    name: "Niclas Lindstedt",
    firstName: "Niclas",
    lastName: "Lindstedt",
    url: "https://github.com/niclaslindstedt",
    sameAs: ["https://github.com/niclaslindstedt"],
  },
  og: { width: 1200, height: 630, default: "og-default.png" },
  theme: { light: "#f7f8fb", dark: "#0b1020" },
  sitemap: "sitemap.xml",
} as const;

export type PageKind = "home" | "docs" | "doc";

export type Page = {
  kind: PageKind;
  /** Path under the base, "" for the home page, e.g. "docs/security/". */
  path: string;
  slug: string;
  title: string;
  description: string;
  ogImage: string;
  ogAlt: string;
  doc?: Doc;
};

export const abs = (path: string) => `${SITE.url}/${path}`;
export const href = (path: string) => `${SITE.base}${path}`;

function clamp(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  return `${cut.slice(0, cut.lastIndexOf(" "))}…`;
}

export function pages(): Page[] {
  const home: Page = {
    kind: "home",
    path: "",
    slug: "home",
    title: SITE.title,
    description: SITE.description,
    ogImage: abs("og/home.png"),
    ogAlt: `${SITE.name}: ${SITE.tagline}`,
  };
  const docsIndex: Page = {
    kind: "docs",
    path: "docs/",
    slug: "docs",
    title: `Documentation — ${SITE.name}`,
    description: clamp(
      `Guides for ${SITE.name}: ${source.docs.map((d) => d.title.toLowerCase()).join(", ")}.`,
      160,
    ),
    ogImage: abs("og/docs.png"),
    ogAlt: `${SITE.name} documentation`,
  };
  const docs = source.docs.map<Page>((doc) => ({
    kind: "doc",
    path: `docs/${doc.slug}/`,
    slug: `docs-${doc.slug}`,
    title: clamp(`${doc.title} — ${SITE.name}`, 60),
    // Escaping (&quot; …) lengthens the rendered attribute; leave headroom.
    description: clamp(doc.summary.replace(/"/g, ""), 150),
    ogImage: abs(`og/docs-${doc.slug}.png`),
    ogAlt: `${doc.title} — ${SITE.name} documentation`,
    doc,
  }));
  return [home, docsIndex, ...docs];
}

/** The page for a location pathname (with or without the base). */
export function pageFor(pathname: string): Page {
  const rel = pathname.startsWith(SITE.base)
    ? pathname.slice(SITE.base.length)
    : pathname.replace(/^\//, "");
  const want = rel === "" || rel.endsWith("/") ? rel : `${rel}/`;
  return (
    pages().find((p) => p.path === want) ??
    pages().find((p) => p.path === rel.replace(/index\.html$/, "")) ??
    pages()[0]!
  );
}
