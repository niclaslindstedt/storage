# Security policy

This project stores health data for people who trust it with their most
private information. Security reports get priority over everything else.

## Supported versions

| Version              | Supported                |
| -------------------- | ------------------------ |
| Latest `0.x` release | ✅ security fixes        |
| Older `0.x` releases | ❌ upgrade to the latest |

Until 1.0 only the latest release line receives fixes; the Docker image tag
`latest` always carries them.

## Reporting a vulnerability

**Do not open a public issue.** Report privately through
[GitHub Security Advisories](https://github.com/niclaslindstedt/storage/security/advisories/new)
or by email to **niclas@agilator.se** (use "SECURITY: storage" in the
subject). Include what you found, how to reproduce it, and the impact you
expect.

## What to expect

- Acknowledgement within **3 working days**.
- An initial assessment (severity, affected versions) within **7 days**.
- A fix or mitigation plan within **30 days** for high and critical issues.

## Disclosure

We follow coordinated disclosure: we agree on a publication date with you,
normally **90 days** after the report or when a fix is released, whichever
comes first. You are credited in the advisory unless you prefer otherwise.

## Scope

In scope:

- `storage-server` (the server, its CLI, the admin page, the Docker image).
- `@niclaslindstedt/storage-testkit` where it could weaken a real server.
- The end-to-end encryption design in [`SPEC.md`](SPEC.md) §4 and its
  client implementation in `@niclaslindstedt/oss-framework/storage`
  (report there or here).
- Anything that lets the server, the network or another user read, forge,
  swap or roll back user data undetected, bypass pairing, invites or
  roles, or keep access after revocation.

Out of scope:

- Metadata the design documents as visible to the server (sizes, timing,
  tree shape, membership) — see [`docs/security.md`](docs/security.md).
- Denial of service by an operator against their own server.
- Servers run with `--test-mode` or with TLS disabled and no proxy.
- Vulnerabilities in dependencies with no demonstrated impact here.

## Publishing credentials

No long-lived publishing credential exists. The `release` workflow
publishes the npm packages to GitHub Packages and the container image to
GHCR with the job's own `GITHUB_TOKEN` — minted per run, scoped to
`packages: write` on this repository, and expired when the job ends — and
signs SLSA build-provenance attestations for both with the job's OIDC
token (`id-token: write`). Verify an image with
`gh attestation verify oci://ghcr.io/niclaslindstedt/storage-server:<version> --owner niclaslindstedt`.

GitHub Packages' npm registry does not offer npm's OIDC trusted-publishing
exchange; the ephemeral job token is its equivalent. If the packages move
to npmjs.com, publishing switches to trusted publishing with
`--provenance`.

The one stored secret is `RELEASE_TOKEN`, which the `version-bump`
workflow uses only to push the release tag (GitHub suppresses workflow
triggers for tags pushed with the default token). It cannot publish
packages.
