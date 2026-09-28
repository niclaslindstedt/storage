# Contributing to storage

Thanks for your interest! This document describes how to set up a
development environment, the conventions we follow, and how to get a change
merged. The design lives in [`SPEC.md`](SPEC.md); read §3–§7 before touching
the protocol or the cryptography.

## Prerequisites

- **Node.js 24** (the version in [`.nvmrc`](.nvmrc); `nvm use`) — the same
  version CI builds, tests and releases with.
- **npm 10+** (ships with Node).
- **git**.
- For the browser tests: Chromium via Playwright
  (`npx playwright install chromium`).
- Optional: Docker (image builds), `shellcheck` and `actionlint`
  (`make shellcheck actionlint`).

## Getting the source

The end-to-end tests and the reference app run the
[`oss-framework`](https://github.com/niclaslindstedt/oss-framework) client
from source, from a checkout next to this repository:

```sh
git clone https://github.com/niclaslindstedt/storage.git
cd storage
npm ci
make framework   # clones oss-framework into ../oss-framework at the ref in e2e/framework-ref
```

Set `OSS_FRAMEWORK_DIR` to use a checkout somewhere else.

## Build, test, lint

```sh
make build        # server + testkit bundles
make test         # server unit tests, testkit tests, full-stack e2e
make test-app     # Playwright tests of the reference app
make examples     # run every example in examples/
make website      # build the website (source extraction → prerender → SEO files)
make lint         # ESLint (zero warnings) + TypeScript in every workspace
make fmt-check    # Prettier
make man          # regenerate man/ from the CLI registry
```

Run one test file: `npx vitest run tests/files_test.ts` inside the workspace
(`packages/server`, `packages/testkit`, `packages/cli` or `e2e`).

## Development workflow

1. Fork the repository.
2. Create a topic branch: `git checkout -b feat/<slug>` or `fix/<slug>`.
3. Make focused commits using [Conventional Commits](https://www.conventionalcommits.org/):
   ```
   <type>(<scope>): <summary>
   ```
   Types: `feat`, `fix`, `perf`, `docs`, `test`, `refactor`, `chore`, `ci`,
   `build`, `style`, `security`. Scopes: `server`, `cli`, `tls`, `net`,
   `testkit`, `e2e`, `app`, `website`, `spec`. Breaking changes: `<type>!:` or a
   `BREAKING CHANGE:` footer.
4. Install the pre-commit hooks once: `make hooks` (formatting, lint,
   commit-message check, whitespace, and a guard against hand edits of
   `CHANGELOG.md`).
5. Open a pull request. The **PR title** must be a conventional-commit
   subject: we squash-merge, and the title becomes the commit on `main`.
6. CI must be green and a maintainer must approve.

## Tests

- Tests live in `tests/` directories, separate from source, and their file
  names end in `_test.ts` (OSS_SPEC §20).
- Write the test first. Every server module has a unit test; every
  user-visible behaviour of the client has a full-stack test in `e2e/`
  against the real server.
- Protocol or crypto changes need an e2e test that proves the property
  (see `e2e/tests/security_test.ts` for the pattern: tamper with the
  server's state and show the client notices).
- No coverage percentage is enforced; a change without tests is not
  merged.

## Documentation

If your change touches user-visible behaviour, update the relevant
`docs/` topic, the README, and — for CLI changes — the registry in
`packages/server/src/cli/spec.ts` (or, for the headless `storage` CLI,
`packages/cli/src/spec.ts`) followed by `make man`. See `AGENTS.md`
for the full "if you change X, update Y" table.

## Pull request review

- A maintainer reviews every PR; security-sensitive areas
  (`packages/server/src/services/auth.ts`, `pairing.ts`, `invites.ts`,
  `crypto.ts`, `tls/`, and the framework client's `crypto.ts`) need the
  project lead's approval.
- We squash-merge. Keep the PR focused; split unrelated changes.

## Where to talk

- **Bugs and feature requests**: [GitHub Issues](https://github.com/niclaslindstedt/storage/issues).
- **Questions and ideas**: [GitHub Discussions](https://github.com/niclaslindstedt/storage/discussions).
- **Security problems**: never in public — see [SECURITY.md](SECURITY.md).

## Governance

- **Model**: BDFL. [@niclaslindstedt](https://github.com/niclaslindstedt)
  has the final say and merge rights.
- **Decisions**: proposals start as an issue or discussion; anything that
  changes the protocol, the cryptography or the security model is recorded
  in `SPEC.md` (§0 decisions log) in the same PR.
- **New maintainers**: invited by the project lead after sustained,
  high-quality contributions; they get merge rights on `main` through
  CODEOWNERS.
- **Disagreements**: discussed on the issue; if no consensus, the project
  lead decides and records why.
- **If the project is abandoned**: the license allows forks for
  noncommercial use; the project lead will transfer the repository to an
  active maintainer on request rather than archive it silently.

## Code of Conduct

By participating you agree to abide by the [Code of Conduct](CODE_OF_CONDUCT.md).

## Reporting security issues

See [SECURITY.md](SECURITY.md). Do **not** open public issues for security
problems.
