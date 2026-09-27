---
name: Bug report
about: Report a reproducible problem with the server, testkit or client
labels: bug
---

<!-- Security problems (anything that could expose data, keys or accounts):
do NOT open an issue — follow SECURITY.md to report privately. -->

## Description

A clear and concise description of the bug.

## Steps to reproduce

1.
2.
3.

## Expected behavior

What you expected to happen.

## Actual behavior

What actually happened. Include error messages and the relevant lines of
`storage-server --debug-agent` / the debug log (no pairing codes, tokens or
recovery keys).

## Environment

- storage-server version (`storage-server --version`):
- How it runs (Docker image tag / Node.js version + OS):
- TLS mode and network (ACME, self-signed, reverse proxy; UPnP on/off):
- Client (app + oss-framework version, browser / platform):
- Output of `storage-server doctor` if the problem is connectivity:
