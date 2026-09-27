# Security model

Built for healthcare data: the hoster — even the admin, even someone who
steals the disk — cannot read what the apps store.

## What the server sees

| Visible to the server                                  | Never visible                                        |
| ------------------------------------------------------ | ---------------------------------------------------- |
| Account and device names, roles                        | File contents, record values                         |
| Namespace count, the app each belongs to, member lists | File and folder names, collection names, record keys |
| Sizes, timestamps, access patterns, tree shape         | Namespace names, icons, colours                      |
| Ciphertext and its key epoch                           | Any key that decrypts anything                       |

## Keys

- **Device keys** — P-256 ECDSA (sign-in) and ECDH (receiving keys), made on
  the device, private halves non-extractable (IndexedDB on the web;
  Keychain / Android Keystore via the native key-vault host).
- **Account key** — a P-256 ECDH key pair per account. The server stores its
  private half only sealed: under your recovery key, and to each of your
  devices.
- **Recovery key** — 256 random bits shown once as text and QR. Never sent.
- **Namespace keys** — 256 random bits per namespace per epoch, sealed to each
  member's account key. HKDF derives separate keys for content and for
  deterministic name encryption.

Content is AES-256-GCM. Each ciphertext's authenticated data binds it to its
namespace and place (a file's content id, a record's collection and key),
so a server that swaps blobs or rows causes a decryption failure, never
silently wrong data. Clients remember the highest change sequence they have
seen per namespace and treat a lower one as a rollback.

## Adding devices and sharing without trusting the server

Key material only moves under secrets the server never sees:

- _Add a device_: the existing device shows a QR code with a random secret
  X. The server receives `HKDF(X, "code")` to authorise the pairing; the
  account key travels sealed under `HKDF(X, "key")`.
- _Share a namespace_: the same construction for an invite; the recipient —
  on their own account, or a new guest account the invite creates — opens
  the namespace keys with X.
- _Approve a device from the server's QR code_: both devices show a
  25-digit safety code derived from the new device's public keys; approve
  only if they match.

## Removing people and devices

Revoking a device kills its sessions, its sealed account key and its event
streams at once. Removing a member deletes their key wraps. Rotating the
namespace key (the app offers it on removal) starts a new epoch wrapped only
to remaining members; the server rejects writes sealed under older epochs,
and the client re-encrypts existing data.

## The server itself

- No passwords. Devices authenticate by signing single-use challenges;
  tokens live ten minutes and are stored hashed.
- Every secret (tokens, pairing and invite codes) is 256-bit, compared in
  constant time, stored as SHA-256, single-use and short-lived.
- Strict validation of every input; opaque names are restricted to a safe
  character set, so path traversal is impossible by construction.
- Per-IP and per-device rate limits; body, header and request timeouts.
- Security headers on every response, HSTS under TLS.
- A hash-chained audit log of pairings, sign-in failures, revocations,
  sharing, rotations and deletions; `storage-server audit verify`.
- The Docker image runs as a non-root user on a read-only root filesystem.
- The [admin console](admin-console.md) listens on loopback by default and
  is unlocked by a token that lives in the data directory. It uses a session
  cookie (HttpOnly, SameSite=Strict) and guards against DNS rebinding and
  CSRF. A strict CSP applies. It shows only what the server already sees.

## Limits

The server can deny service or withhold updates; it cannot read or forge
data. Metadata (sizes, timing, who shares with whom) is visible to it. Use
full-disk encryption on the host to protect that metadata at rest.

Report vulnerabilities privately — see `SECURITY.md`.
