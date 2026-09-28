# Storage Remote (`apps/remote`)

The hoster's own app for their storage server: the admin console and an
end-to-end encrypted drive, on one phone paired as an **admin device**
(SPEC §11.2). What it is for and how to pair it:
[`docs/remote-app.md`](../../docs/remote-app.md). The native wrapper for
iOS and Android is in [`native/`](native/README.md).

## Layout

```
src/
├── main.ts           boot: restore the device, then pair / keys / the app
├── client.ts         the framework client (app id "drive", keystore vault)
├── connect.ts        pairing screen (scan, paste, or an #oss= app link)
├── keys.ts           create the account key / recovery key / approval
├── shell.ts          the three tabs over one hash router
├── console.ts        the console UI's transport over /v1/console
├── sse.ts            Server-Sent Events over fetch (bearer header)
├── hosts.ts          capabilities the native wrapper may offer
├── device.ts         This phone: approve devices, recovery key, sign out
├── ui.ts             set-up screens, QR images, error wording, app naming
├── common.css        what the web drive shares: set-up screens, file lists, versions
├── styles.css        the phone layout over the console's stylesheet and tokens
└── files/
    ├── tree.ts       folders over flat paths (pure, tested)
    ├── drives.ts     the list of shared folders; join an invite
    ├── browser.ts    inside a folder: upload, open, rename, versions, trash
    ├── upload.ts     uploads: replace (a new version) or keep both, in parts
    ├── preview.ts    text and pictures, decrypted on the device
    ├── versions.ts   versions: list, download, restore, compare
    ├── diff.ts       the line diff behind Compare (pure, tested)
    └── share.ts      members and invites
tests/                Vitest (node): tree, diff, console transport, native bridge
browser-tests/        Playwright against `storage-server test-server`
```

The **Server** tab mounts the admin console's own pages
(`packages/server/src/admin/ui`, aliased as `@storage/console/*`) and only
swaps their transport. A console feature lands there and appears here too.
Keep this app from growing a second console.

The **web drive** (`apps/drive`) mounts the Files pages, the key set-up and
This phone (as "This browser") unchanged, so keep them free of
phone-only assumptions. `ui.ts`'s `app` names the app and the device.

The framework is used from source like the reference app. Only its
dependency-free parts are imported: the self-hosted client and the QR
encoder.

## Commands

```sh
make framework                         # the oss-framework checkout (once)
npm run dev --workspace apps/remote    # http://localhost:4175
npm run build --workspace apps/remote  # dist/ (what native/ bundles)
npm run test --workspace apps/remote   # unit tests
make build && npm run test:e2e --workspace apps/remote   # browser tests
```

To try it against a real server, pair from `storage-server pair --account
<you> --console` (the server must allow the dev origin: pairing from it
teaches the server the origin).
