// SSR entry for scripts/prerender.mjs (OSS_SPEC §11.3.1): renders each route
// to static HTML plus its own <head>. Doc bodies come from the generated
// data here; the client hydrates them from the DOM instead.

import { StrictMode } from "react";
import { renderToString } from "react-dom/server";

import { App } from "./App";
import { docBodies, source } from "./generated/sourceData";
import { headHtml } from "./head";
import { pages, SITE, type Page } from "./site";

export { pages, SITE, source };

export function render(page: Page, options: { notFound?: boolean } = {}) {
  const body = page.doc ? (docBodies[page.doc.slug] ?? "") : "";
  const html = renderToString(
    <StrictMode>
      <App page={page} docBody={body} />
    </StrictMode>,
  );
  return { html, head: headHtml(page, options) };
}
