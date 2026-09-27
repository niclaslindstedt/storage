# Hosting at home

A Raspberry Pi, a NAS or an old laptop is plenty. The server needs Node.js
22.13+ or Docker, about 100 MB of RAM, and disk for your (encrypted) data.

## The one-liner

```sh
docker run -d --name storage --restart unless-stopped --network host \
  -v storage-data:/data \
  -e STORAGE_TLS=acme -e STORAGE_DOMAINS=home.example.org \
  -e STORAGE_PORT=443 -e STORAGE_HTTP_PORT=80 -e STORAGE_UPNP=1 \
  -e STORAGE_ACME_EMAIL=me@example.org \
  ghcr.io/niclaslindstedt/storage-server:latest
```

`--network host` lets UPnP discovery (multicast) reach the router.

## Port forwarding: `--upnp`

The server asks the router to forward its ports — UPnP IGD first, NAT-PMP
(Apple and many others) second — renews the lease at half-life and removes
the mapping on shutdown. If your router has neither enabled, forward TCP 443
(and 80 for `http-01`) to the server by hand.

It also reads the router's WAN address and tells you when it is
**carrier-grade NAT** (100.64.0.0/10) or **private** (double NAT): then no
forwarding can make the server reachable, and a tunnel is the answer.

## Certificates: `--tls acme`

Browsers only talk to servers with publicly trusted certificates, so a home
server needs one. The server is its own ACME client:

- **With a domain** (your own, or a dynamic-DNS name pointing at your home
  IP): `--domain home.example.org`.
- **Without a domain**: `--domain 203.0.113.7` requests a short-lived
  certificate for your public IP address (the `shortlived` profile, renewed
  automatically every few days). If your IP changes, update `--domain` —
  or use dynamic DNS.

Validation uses `http-01` when `--http-port` is set (port 80 must be
reachable) and `tls-alpn-01` on the HTTPS port otherwise. Certificates are
renewed when a third of their lifetime remains and swapped in without a
restart.

## Pairing from outside

The QR codes carry `--public-url` (or the certified name). Set it to what
your devices use from anywhere, e.g. `https://home.example.org`.

## Behind a tunnel

With CGNAT, or to avoid opening ports at all:

```sh
storage-server serve --tls off --port 8080 --trust-proxy \
  --public-url https://storage.example.org
```

and point Cloudflare Tunnel, Tailscale Funnel or your reverse proxy at
`http://127.0.0.1:8080`. Data stays end-to-end encrypted either way; the
tunnel operator sees only ciphertext.

## Backups

`storage-server backup --out /mnt/usb/storage-$(date +%F)` is safe while the
server runs. Keep the recovery keys of your accounts separately — a backup
without them is unreadable, which is the point.
