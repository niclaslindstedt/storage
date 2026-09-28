import { useState } from "react";

import { source } from "../generated/sourceData";
import { href, SITE } from "../site";
import { CodeBlock } from "./CodeBlock";

const IMAGE = "ghcr.io/niclaslindstedt/storage-server";
const QUICK_START = `docker run -d --name storage -p ${source.defaults.port}:${source.defaults.port} \\
  -v storage-data:/data ${IMAGE}
docker exec storage /nodejs/bin/node /app/dist/cli.js setup --account you`;

const FEATURES = [
  {
    title: "Zero-knowledge by design",
    text: "Contents, file names, collection names and record keys are encrypted on the device with keys the server never sees. A stolen disk or a curious admin gets ciphertext.",
    code: `// what the server stores for a record
{ "coll": "1.Qk3v…", "key": "1.9sXa…",
  "value": "T1NFMQEAAAAB…" }`,
  },
  {
    title: "Row-level merge, not file conflicts",
    text: "Two devices edit the same medication offline — one the dose, one the schedule. Both edits survive. True conflicts resolve the same way on every device.",
    code: `phone:  dose     200mg → 400mg
tablet: schedule [08] → [08, 20]
merged: { dose: 400mg, schedule: [08, 20] }`,
  },
  {
    title: "Share one namespace",
    text: "Invite a carer to “Mum's medication” without sharing an account or anything else. Removing someone rotates the key; they keep nothing new.",
    code: `const { payload } = await meds.invite({ role: "editor" });
// → QR code; the carer scans it, sees only this namespace`,
  },
  {
    title: "Pair with a QR code",
    text: "Scan to connect a phone. Pairing codes are one-time and short-lived; the certificate fingerprint travels in the QR, and a 25-digit safety code confirms each new device.",
    code: `$ ${source.bin} pair --new mum
# prints a one-time pairing QR code, valid for 10 minutes`,
  },
  {
    title: "Host it at home",
    text: "Built-in Let's Encrypt (ACME) and router port mapping (UPnP / NAT-PMP), with CGNAT detection and a doctor command. A Raspberry Pi is plenty.",
    code: `$ ${source.bin} serve --tls acme --domain home.example.org --upnp
# gets a certificate, asks the router to forward the port`,
  },
  {
    title: "An admin console in the browser",
    text: "Accounts, devices, pairing QR codes, live logs, traffic charts, the audit chain and health checks with fixes — on the server's loopback, plus Prometheus metrics.",
    code: `$ ${source.bin} admin
http://127.0.0.1:8081/login?token=…`,
  },
  {
    title: "Run it from your phone",
    text: "Storage Remote pairs your phone as an admin device: every console page, from anywhere, plus your own files in encrypted, shareable folders. Only the machine itself can grant it.",
    code: `$ ${source.bin} pair --account you --console
# scan with Storage Remote: the phone is now an admin device`,
  },
  {
    title: "The easiest backend to test",
    text: "Start a real server in-process in milliseconds. Inject faults, move the clock, snapshot and restore — from Vitest or Playwright.",
    code: `const server = await startTestServer();
await server.faults.status(503, { times: 1 });
await server.clock.advance(24 * 3600_000);`,
  },
];

const TLS_TEXT: Record<string, string> = {
  acme: "Let's Encrypt or any ACME CA, renewed automatically",
  files: "Your own certificate and key files",
  "self-signed": "Generated on first start; pinned by fingerprint in the QR",
  off: "Plain HTTP behind a TLS-terminating reverse proxy",
};

function Hero() {
  return (
    <section className="hero">
      <div className="wrap">
        <p className="eyebrow">
          Self-hosted · end-to-end encrypted · v{source.version}
        </p>
        <h1>{SITE.tagline}</h1>
        <p className="lede">{SITE.description}</p>
        <div className="cta">
          <a className="button primary" href={href("docs/getting-started/")}>
            Get started
          </a>
          <a className="button" href={href("docs/security/")}>
            Security model
          </a>
          <a className="button ghost" href={source.repo} rel="noopener">
            GitHub
          </a>
        </div>
        <CodeBlock code={QUICK_START} lang="sh" label="Run it" />
      </div>
    </section>
  );
}

function Features() {
  return (
    <section id="features" className="section">
      <div className="wrap">
        <h2>Built for personal, sensitive data</h2>
        <p className="section-lede">
          Made for local-first apps that keep health records, medication lists
          and family calendars — where Dropbox and iCloud are the wrong trade.
        </p>
        <div className="features">
          {FEATURES.map((f) => (
            <article key={f.title} className="card">
              <h3>{f.title}</h3>
              <p>{f.text}</p>
              <pre className="mini">
                <code>{f.code}</code>
              </pre>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function Examples() {
  const [active, setActive] = useState(0);
  const ex = source.examples[active]!;
  return (
    <section id="example" className="section alt">
      <div className="wrap">
        <h2>See it work</h2>
        <p className="section-lede">
          Runnable examples from the repository, exercised by CI on every
          change.
        </p>
        <div className="tabs" role="tablist" aria-label="Examples">
          {source.examples.map((e, i) => (
            <button
              key={e.slug}
              type="button"
              role="tab"
              id={`tab-${e.slug}`}
              aria-selected={i === active}
              aria-controls="example-panel"
              onClick={() => setActive(i)}
            >
              {e.title}
            </button>
          ))}
        </div>
        <div
          id="example-panel"
          role="tabpanel"
          aria-labelledby={`tab-${ex.slug}`}
        >
          <p>
            {ex.summary}{" "}
            <a href={ex.source} rel="noopener">
              View on GitHub
            </a>
          </p>
          <CodeBlock
            code={ex.code}
            lang={ex.lang}
            label={`examples/${ex.slug}/${ex.file}`}
          />
        </div>
      </div>
    </section>
  );
}

function Compatibility() {
  return (
    <section id="platforms" className="section">
      <div className="wrap">
        <h2>Runs on, works with</h2>
        <div className="grid-3">
          <div className="card">
            <h3>Hosts</h3>
            <ul className="checks">
              <li>Docker image, linux/amd64 and linux/arm64</li>
              <li>Node.js {source.node}+ on Linux or macOS</li>
              <li>Raspberry Pi, NAS, VPS or any cloud VM</li>
              <li>Router port mapping: UPnP IGD, NAT-PMP</li>
            </ul>
          </div>
          <div className="card">
            <h3>TLS modes</h3>
            <table>
              <tbody>
                {source.tlsModes.map((m) => (
                  <tr key={m}>
                    <th scope="row">
                      <code>{m}</code>
                      {m === source.defaults.tls ? " (default)" : ""}
                    </th>
                    <td>{TLS_TEXT[m] ?? m}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="card">
            <h3>Clients</h3>
            <ul className="checks">
              <li>
                Web apps and PWAs via <code>oss-framework/storage</code>
              </li>
              <li>Keys in non-extractable WebCrypto (IndexedDB)</li>
              <li>Native shells: hardware keystore via a host vault</li>
              <li>
                Tests: <code>@niclaslindstedt/storage-testkit</code>
              </li>
            </ul>
          </div>
        </div>
        <p className="caps">
          Protocol v{source.protocol} capabilities:{" "}
          {source.capabilities.map((c) => (
            <code key={c}>{c}</code>
          ))}
        </p>
      </div>
    </section>
  );
}

function Cli() {
  return (
    <section id="cli" className="section alt">
      <div className="wrap">
        <h2>One binary, every operation</h2>
        <p className="section-lede">
          Every command has <code>--help</code>, a man page and machine-readable
          output for agents (<code>{source.bin} commands</code>
          ).
        </p>
        <div className="table-scroll">
          <table className="commands">
            <thead>
              <tr>
                <th scope="col">Command</th>
                <th scope="col">What it does</th>
              </tr>
            </thead>
            <tbody>
              {source.commands.map((c) => (
                <tr key={c.name}>
                  <th scope="row">
                    <code>{c.name}</code>
                  </th>
                  <td>{c.summary}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <details className="settings">
          <summary>
            Configuration: {source.settings.length} settings, as flag,
            environment variable or config.json key
          </summary>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col">Flag</th>
                  <th scope="col">Environment</th>
                  <th scope="col">Default</th>
                  <th scope="col">Description</th>
                </tr>
              </thead>
              <tbody>
                {source.settings.map((s) => (
                  <tr key={s.flag}>
                    <td>
                      <code>{s.flag}</code>
                    </td>
                    <td>
                      <code>{s.env}</code>
                    </td>
                    <td>{s.default ?? "—"}</td>
                    <td>{s.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </div>
    </section>
  );
}

function Install() {
  const npmrc = `@niclaslindstedt:registry=https://npm.pkg.github.com
npm install @niclaslindstedt/storage-server @niclaslindstedt/storage-testkit`;
  const fromSource = `git clone ${source.repo}.git && cd storage
npm ci && make build
node packages/server/dist/cli.js serve`;
  return (
    <section id="install" className="section">
      <div className="wrap">
        <h2>Install</h2>
        <p className="badges">
          <a href={`${source.repo}/actions/workflows/ci.yml`} rel="noopener">
            <img
              src={`${source.repo}/actions/workflows/ci.yml/badge.svg`}
              alt="CI status"
              width="90"
              height="20"
              loading="lazy"
            />
          </a>
          <a
            href={`${source.repo}/pkgs/container/storage-server`}
            rel="noopener"
          >
            <img
              src={`https://img.shields.io/badge/ghcr.io-v${source.version}-blue`}
              alt={`Container image v${source.version}`}
              width="110"
              height="20"
              loading="lazy"
            />
          </a>
        </p>
        <div className="grid-3">
          <div>
            <h3>Docker</h3>
            <CodeBlock
              code={`docker pull ${IMAGE}:${source.version}`}
              lang="sh"
            />
          </div>
          <div>
            <h3>npm (GitHub Packages)</h3>
            <CodeBlock code={npmrc} lang="sh" />
          </div>
          <div>
            <h3>From source</h3>
            <CodeBlock code={fromSource} lang="sh" />
          </div>
        </div>
        <p>
          Releases, container digests and provenance attestations are on the{" "}
          <a href={`${source.repo}/releases`} rel="noopener">
            releases page
          </a>
          .
        </p>
      </div>
    </section>
  );
}

function Docs() {
  return (
    <section id="docs" className="section alt">
      <div className="wrap">
        <h2>Documentation</h2>
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
        {source.release && (
          <div className="release">
            <h3>
              What's new in v{source.release.version} ({source.release.date})
            </h3>
            <div dangerouslySetInnerHTML={{ __html: source.release.html }} />
          </div>
        )}
      </div>
    </section>
  );
}

export function Home() {
  return (
    <>
      <Hero />
      <Features />
      <Examples />
      <Compatibility />
      <Cli />
      <Install />
      <Docs />
    </>
  );
}
