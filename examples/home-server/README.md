# Home server

Run storage-server on a Raspberry Pi, a NAS or an old laptop, reachable from
your phone anywhere, with a real certificate and no manual router setup.

[`compose.yaml`](compose.yaml) runs the published image with:

- **Let's Encrypt via built-in ACME** — `STORAGE_TLS=acme` plus your
  domain; certificates renew themselves.
- **Automatic port mapping** — `STORAGE_UPNP=1` asks the router (UPnP IGD
  or NAT-PMP) to forward the ports, and renews the lease. Host networking
  lets the discovery packets reach the router.
- **Hardening** — read-only root filesystem, no capabilities, non-root user,
  data on a named volume.

```sh
docker compose up -d
docker compose exec storage /nodejs/bin/node /app/dist/cli.js setup --account you
```

`setup` prints a QR code; scan it with the app to create the admin account
on your phone. `... cli.js admin` prints a sign-in link for the admin
console on the host's `127.0.0.1:8081` (use `ssh -L 8081:127.0.0.1:8081`
from another computer). The server stores only ciphertext — the keys never leave your
devices. Run `storage-server doctor` when something does not connect; see
[docs/home-hosting.md](../../docs/home-hosting.md) for CGNAT, double NAT and
dynamic DNS.

`check.sh` is what CI runs: it validates the compose file and walks the same
start → health → setup path against the locally built server.
