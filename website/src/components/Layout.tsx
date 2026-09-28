import { source } from "../generated/sourceData";
import { href, SITE, type Page } from "../site";

export function Header({ page }: { page: Page }) {
  const link = (path: string, label: string, active: boolean) => (
    <a href={href(path)} aria-current={active ? "page" : undefined}>
      {label}
    </a>
  );
  return (
    <header className="site-header">
      <a className="skip" href="#main">
        Skip to content
      </a>
      <nav aria-label="Main" className="wrap nav">
        <a className="brand" href={href("")}>
          <Logo /> {SITE.name}
        </a>
        <div className="nav-links">
          {link("#features", "Features", false)}
          {link("#example", "Example", false)}
          {link("docs/", "Docs", page.kind !== "home")}
          <a className="nav-drive" href={href("drive/")}>
            Your files
          </a>
          <a href={source.repo} rel="noopener">
            GitHub
          </a>
        </div>
      </nav>
    </header>
  );
}

export function Logo() {
  return (
    <svg
      className="logo"
      viewBox="0 0 32 32"
      width="28"
      height="28"
      aria-hidden="true"
    >
      <rect x="3" y="5" width="26" height="8" rx="3" fill="currentColor" />
      <rect
        x="3"
        y="15"
        width="26"
        height="8"
        rx="3"
        fill="currentColor"
        opacity=".6"
      />
      <circle cx="24" cy="9" r="1.8" fill="var(--bg)" />
      <path d="M13 26h6v3h-6z" fill="currentColor" opacity=".6" />
    </svg>
  );
}

const date = (iso: string) => iso.slice(0, 10);

export function Footer() {
  return (
    <footer className="site-footer">
      <div className="wrap footer-grid">
        <div>
          <p className="brand">
            <Logo /> {SITE.name}
          </p>
          <p>
            v{source.version} · updated{" "}
            <time dateTime={source.lastUpdated}>
              {date(source.lastUpdated)}
            </time>
          </p>
          <p>
            {source.license} ·{" "}
            <a href={`${source.repo}/blob/main/LICENSE`} rel="noopener">
              License
            </a>{" "}
            ·{" "}
            <a href={`${source.repo}/blob/main/CHANGELOG.md`} rel="noopener">
              Changelog
            </a>
          </p>
        </div>
        <nav aria-label="Documentation">
          <p className="footer-title">Documentation</p>
          <ul>
            {source.docs.map((d) => (
              <li key={d.slug}>
                <a href={href(`docs/${d.slug}/`)}>{d.title}</a>
              </li>
            ))}
          </ul>
        </nav>
        <nav aria-label="Project">
          <p className="footer-title">Project</p>
          <ul>
            <li>
              <a href={href("")}>Home</a>
            </li>
            <li>
              <a href={href("docs/")}>All docs</a>
            </li>
            <li>
              <a href={source.repo} rel="noopener">
                Source code
              </a>
            </li>
            <li>
              <a href={`${source.repo}/issues`} rel="noopener">
                Issues
              </a>
            </li>
            <li>
              <a href={`${source.repo}/discussions`} rel="noopener">
                Discussions
              </a>
            </li>
            <li>
              <a href={`${source.repo}/blob/main/SECURITY.md`} rel="noopener">
                Security policy
              </a>
            </li>
          </ul>
        </nav>
      </div>
    </footer>
  );
}
