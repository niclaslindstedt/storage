import { useMemo, useState } from "react";

import { source } from "../generated/sourceData";
import { href, type Page } from "../site";

function Sidebar({ current }: { current?: string }) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const matches = useMemo(
    () =>
      source.docs.filter(
        (d) =>
          !q ||
          d.title.toLowerCase().includes(q) ||
          d.summary.toLowerCase().includes(q) ||
          q.split(/\s+/).every((w) => d.terms.includes(w)) ||
          d.headings.some((h) => h.text.toLowerCase().includes(q)),
      ),
    [q],
  );
  return (
    <nav className="docs-nav" aria-label="Documentation">
      <label className="search">
        <span className="visually-hidden">Search the docs</span>
        <input
          type="search"
          placeholder="Search the docs"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      <ul>
        {matches.map((d) => (
          <li key={d.slug}>
            <a
              href={href(`docs/${d.slug}/`)}
              aria-current={d.slug === current ? "page" : undefined}
            >
              {d.title}
            </a>
            {q &&
              d.headings
                .filter((h) => h.text.toLowerCase().includes(q))
                .map((h) => (
                  <a
                    key={h.id}
                    className="hit"
                    href={href(`docs/${d.slug}/#${h.id}`)}
                  >
                    {h.text}
                  </a>
                ))}
          </li>
        ))}
        {matches.length === 0 && <li className="empty">No matches</li>}
      </ul>
    </nav>
  );
}

function DocIndex() {
  return (
    <article className="doc">
      <h1>Documentation</h1>
      <p className="lede">
        Everything about running, securing and building on storage-server. Start
        with <a href={href("docs/getting-started/")}>Getting started</a>.
      </p>
      <ul className="doc-cards">
        {source.docs.map((d) => (
          <li key={d.slug}>
            <a href={href(`docs/${d.slug}/`)}>
              <strong>{d.title}</strong>
              <span>{d.summary}</span>
            </a>
          </li>
        ))}
      </ul>
    </article>
  );
}

function DocArticle({ page, body }: { page: Page; body: string }) {
  const doc = page.doc!;
  const i = source.docs.findIndex((d) => d.slug === doc.slug);
  const prev = source.docs[i - 1];
  const next = source.docs[i + 1];
  return (
    <article className="doc">
      <p className="crumbs">
        <a href={href("docs/")}>Docs</a> / {doc.title}
      </p>
      <h1>{doc.title}</h1>
      <p className="doc-meta">
        Updated <time dateTime={doc.modified}>{doc.modified.slice(0, 10)}</time>{" "}
        ·{" "}
        <a href={doc.source} rel="noopener">
          Edit on GitHub
        </a>
      </p>
      {doc.headings.length > 2 && (
        <nav className="toc" aria-label="On this page">
          <p>On this page</p>
          <ul>
            {doc.headings.map((h) => (
              <li key={h.id}>
                <a href={`#${h.id}`}>{h.text}</a>
              </li>
            ))}
          </ul>
        </nav>
      )}
      <div
        id="doc-body"
        className="prose"
        dangerouslySetInnerHTML={{ __html: body }}
      />
      <nav className="pager" aria-label="Previous and next">
        {prev ? (
          <a href={href(`docs/${prev.slug}/`)}>← {prev.title}</a>
        ) : (
          <span />
        )}
        {next && <a href={href(`docs/${next.slug}/`)}>{next.title} →</a>}
      </nav>
    </article>
  );
}

export function DocsPage({ page, body }: { page: Page; body: string }) {
  return (
    <div className="wrap docs">
      <Sidebar current={page.doc?.slug} />
      {page.kind === "doc" ? (
        <DocArticle page={page} body={body} />
      ) : (
        <DocIndex />
      )}
    </div>
  );
}
