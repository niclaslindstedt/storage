# Getting started

This guide takes you from nothing to a paired phone in about five minutes.

## 1. Run the server

With Docker (recommended):

```sh
docker run -d --name storage --restart unless-stopped \
  -p 8443:8443 -v storage-data:/data \
  ghcr.io/niclaslindstedt/storage-server:latest
```

Or with Node.js 24 or newer:

```sh
npx @niclaslindstedt/storage-server serve --data-dir ~/storage
```

The first start prints a QR code in the terminal (`docker logs storage` with
Docker). It is a one-time code that creates the **admin** account on the
first device that scans it. It expires after ten minutes; print a fresh one
any time with `storage-server setup`.

`storage-server admin` (in Docker: `docker exec storage /nodejs/bin/node
/app/dist/cli.js admin`) prints a sign-in link for the **admin console**, a local web page for
managing accounts and devices, showing pairing QR codes, watching traffic
and logs, and troubleshooting. See [Admin console](admin-console.md).

## 2. Pair your first device

Open an app that supports the self-hosted backend (any app built on
`@niclaslindstedt/oss-framework` ≥ the release that added
`storage/selfhosted`), choose **Self-hosted** as the storage backend, and scan
the QR code (or paste the `oss-storage://pair?...` line under it).

The app then:

1. Generates the device's own key pairs. The private keys never leave the
   device; on the web they are non-extractable WebCrypto keys in IndexedDB.
2. Creates your **account key** and shows your **recovery key** once. Write
   it down or save its QR code somewhere safe: it is the only way to recover
   your data if you lose every device. The server never sees it.

## 3. Add more devices

From a device you already have, choose **Add device**: it shows a QR code
that carries both the sign-in code and — sealed under a secret only the QR
code holds — your account key. Scan it with the new device and it is ready,
with nothing typed.

Without another device at hand, run `storage-server pair --account <name>`
on the server and enter your recovery key on the new device instead.

## 4. Make it reachable from outside your home

Read [home-hosting.md](home-hosting.md): one flag (`--upnp`) forwards the
port on most routers, and `--tls acme` gets a real certificate — for a
domain name, or for your bare public IP address.

## Next

- [Sharing one namespace](sharing.md) with someone else, without sharing your account.
- [Admin console](admin-console.md) — administer, monitor and troubleshoot in a browser.
- [Security model](security.md) — what the server can and cannot see.
- [Testing](testing.md) — the test server your app's end-to-end tests run against.
