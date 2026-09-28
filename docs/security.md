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

## Admin devices (Storage Remote)

The [remote app](remote-app.md) runs the admin console from a phone. It
reaches the console's API through the device API (`/v1/console`) as an
**admin device**, and the rules keep that from widening who can administer
the server:

- **Granted at the machine only.** An admin device is paired with a code
  minted by the local console or `storage-server pair --console`. Those are
  places only someone who can already administer the server reaches. The
  device API refuses to mint such a code for anyone, admin devices included,
  so a stolen phone cannot create more of them.
- **Admin accounts only.** A console pairing is refused for other accounts.
  A device is an admin device only while its account is an admin: demoting
  or disabling the account ends its console access at once.
- **Device-bound, like every sign-in.** The phone signs challenges with its
  own non-extractable key (kept in the Keychain / Android Keystore by the
  native app). There is no admin token on the phone and no password.
- **Revocable in two steps.** _Remove admin access_ drops console access
  but leaves the device paired, and access cannot be granted back except by
  pairing again at the machine. _Revoke_ signs it out.
- **Audited by name.** Every change an admin device makes is recorded under
  its device id, not a shared "admin-console" actor.
- **Switchable.** `--remote-console off` disables `/v1/console` for every
  device. Until an admin device is paired, the endpoint answers `403` to
  everyone.

The remote console sees exactly what the local one does: names, sizes and
counts, never content. The app's own files are end-to-end encrypted like
any other app's.

## Agent devices (AI agents, MCP)

An **agent device** is a device held to a scope: the permissions
(`data:read`, `data:write`, `sharing`, `devices`, `console:read`,
`console:write`) and, optionally, the apps it may use. It is what the
[`storage-mcp`](mcp.md) server runs as, so an AI agent works with a
credential that can do only what you granted.

- **Enforced by the server, on every request.** The scope is stored with
  the device and checked before any route runs; routes without a
  classification are refused. Namespaces of other apps do not exist for it
  (`404`), and their change events are not sent to it.
- **Granted where access already exists, never widened.** A scope is set
  when a pairing is minted — by the console or the CLI, or by a device of
  the account for its own account, never wider than that device. It can be
  narrowed afterwards (`PATCH /api/devices/:id {agent}`), never widened.
  Devices and pairings an agent creates inherit its scope; console
  permissions require an admin-device pairing, made at the machine.
- **No key handover without `devices`.** Such an agent may store its own
  first copy of the account key (after recovery or approval) and may revoke
  itself, but cannot approve another device, pair one, or replace the
  recovery key.
- **Plaintext stays with the agent's operator.** `storage-mcp` decrypts on
  the agent's machine, like any app. The server still sees only
  ciphertext; the agent's model provider sees whatever the agent reads.

`storage-mcp` adds its own guards on top — human confirmation for
destructive, sharing and credential-minting actions, secrets kept out of
the model's context, fenced untrusted content, one-origin TLS with pinning,
an encrypted key vault and a local audit log. See [AI agents](mcp.md).

## Earlier versions

Overwriting a file keeps the version it replaced (30 days by default, an
admin setting). The server keeps only the older ciphertext. Opening,
comparing and restoring versions happens on a device, like everything else.
When someone is removed from a folder, its key is rotated and the current
files are re-encrypted, which adds a version of each. The earlier versions
stay sealed under the old key. The removed person can no longer fetch
anything from the folder. A server that colluded with them could open only
versions from before the removal, which they could read anyway. To be rid
of old versions sooner, shorten the history setting, or delete the file
for good from the trash.

## The web drive

The [web drive](drive.md) is a page that holds your keys, served by the
project's website (GitHub Pages) and built there by CI from this
repository. Its keys are non-extractable WebCrypto keys in IndexedDB, in a
vault of its own. A strict content security policy lets the page load only
its own files and talk only to storage servers. No page is safer than
whoever serves its code, though. Whoever controls the website could change
the page and read what you open in it. That is true of every web app that
encrypts in the browser. The server cannot change the page, so a
malicious server still gets only ciphertext. If the website is not a party
you want to trust, build the drive (`make drive`) and serve it yourself, or
use Storage Remote's native app, which carries its page inside the
download.

## Limits

The server can deny service or withhold updates; it cannot read or forge
data. Metadata (sizes, timing, who shares with whom) is visible to it. Use
full-disk encryption on the host to protect that metadata at rest.

Report vulnerabilities privately — see `SECURITY.md`.
