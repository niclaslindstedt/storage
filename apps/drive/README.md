# The web drive (`apps/drive`)

Your files on your storage server in any browser, like Dropbox: sign in by
pairing, browse your shared folders, upload (drag and drop), preview, share,
compare and restore earlier versions, and watch changes sync in live. It is
published on the website at `/storage/drive/`. What it is for and how to
sign in: [`docs/drive.md`](../../docs/drive.md). Design: SPEC §11.5.

## Layout

```
src/
├── main.ts        boot: restore this browser's device, then sign in / keys / the drive
├── connect.ts     the sign-in screen (paste a code, or an #oss= link)
├── shell.ts       top bar, sidebar of shared folders, hash router
├── sync.ts        SyncMonitor: /v1/events + the change feed → status and activity (pure, tested)
├── activity.ts    the sync pill and the Activity page
└── styles.css     layout over the console's stylesheet and common.css
tests/             Vitest (node): the sync monitor
browser-tests/     Playwright against `storage-server test-server`
```

The folder pages, key set-up and device page are Storage Remote's own
(`apps/remote/src`, aliased as `@storage/remote/*`), so the phone and the
browser behave the same. A change to the file pages lands there. That
includes the versions dialog and its text diff (`files/versions.ts`,
`files/diff.ts`), uploads (`files/upload.ts`) and the preview
(`files/preview.ts`).

## Commands

```sh
make drive                                   # build into apps/drive/dist
npm run dev --workspace apps/drive           # http://localhost:4176
npm run test --workspace apps/drive          # unit tests
npm run test:e2e --workspace apps/drive      # Playwright (needs `make build`)
make website                                 # the website, with the drive at /storage/drive/
```

The framework is used from source (`OSS_FRAMEWORK_DIR`, default
`../oss-framework`; `make framework`), like Storage Remote.
