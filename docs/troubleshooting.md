# Troubleshooting

Start with `storage-server doctor --public-url <url>`: it checks the data
directory, database integrity, the audit chain, the certificate, router port
mapping and NAT type, and whether the public URL answers.

## A device cannot connect

- `curl -v <url>/v1/info` from outside your network. A timeout means the
  port is not forwarded; a certificate error means TLS; a JSON answer means
  the server is fine and the problem is in the app.
- Behind the same router, some routers do not support hairpin NAT: use the
  LAN address at home or a DNS name that resolves to it.

## "The certificate is not trusted"

- `--tls self-signed` only works for native wrappers that pin the key from
  the QR code. Browser PWAs need `--tls acme` (or `files`, or a proxy).
- ACME failing: `storage-server cert status`. `http-01` needs port 80
  reachable from the internet (`--http-port 80` and a mapping for it);
  `tls-alpn-01` needs port 443. Use `--acme-directory
https://acme-staging-v02.api.letsencrypt.org/directory` while
  experimenting to avoid production rate limits.

## Port forwarding

`storage-server upnp status`. The command says so explicitly when your
router's WAN address is carrier-grade NAT (100.64.0.0/10) or private
(double NAT) — port forwarding cannot work then; use a tunnel with
`--tls off`.

## Browser says the origin is not allowed

In `--cors paired` mode an origin is allowed after a device paired from it.
Pair from that origin or add `--cors-origin https://app.example`.

## 401 Unauthorized

The device was revoked or its account disabled (`storage-server devices
list`), or its clock is far off (tokens live ten minutes).

## 410 Gone from the change feed

The device was offline longer than the tombstone retention (90 days by
default); the client resyncs from scratch automatically.

## Reporting a bug

Run with `--debug`, reproduce, and attach the debug log
(`storage-server --debug-agent` shows its path) and the `doctor` output.
Never attach the data directory.
