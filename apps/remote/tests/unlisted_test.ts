// Storage Remote's page is an app, not a site to be found: it ships inside
// the phone app, and any copy of it served on the web stays out of search
// results. The docs website is the one that is meant to be found.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const html = readFileSync(
  join(import.meta.dirname, "..", "index.html"),
  "utf8",
);

describe("the page is unlisted", () => {
  it("carries a robots noindex meta", () => {
    expect(html).toMatch(/<meta\s+name="robots"\s+content="[^"]*\bnoindex\b/);
  });

  it("names no sitemap and no canonical address", () => {
    expect(html).not.toMatch(/sitemap/i);
    expect(html).not.toMatch(/rel="canonical"/);
  });
});
