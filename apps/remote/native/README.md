# Storage Remote for iOS and Android

A thin Expo / React Native wrapper that ships [Storage Remote](../README.md)
to phones. It is a **separate npm project**: its own `package.json`,
lockfile and `node_modules`. The storage repo's root `npm ci` does not
install it.

The wrapper does four things, and only these four:

1. It packs the built web app into `assets/webroot.zip` and serves it from a
   loopback HTTP server (`src/local-server.ts`, port `8321` with fallbacks).
   The app runs from inside the download. The only network traffic is to
   your own storage server.
2. It points a `WebView` at that origin.
3. Before the page loads, it injects `src/bridge.ts`, which offers the page
   three capabilities a browser does not have:
   - **Keys in the platform keystore.** It installs the framework's key vault
     seam (`window.__ossKeyVault`, SPEC §4.4). The page's device keys and
     account key live in the iOS Keychain / Android Keystore through
     `expo-secure-store`. They are readable only while the phone is unlocked,
     and never go into a backup or a device transfer
     (`WHEN_UNLOCKED_THIS_DEVICE_ONLY`). See `src/keychain.ts`.
   - **A QR scanner** (`__storageRemoteScanner`): the camera reads the pairing
     code from the server's console or an invite to a shared folder. No frame
     is kept (`src/Scanner.tsx`).
   - **The share sheet** (`__storageRemoteShare`): a file the page has just
     decrypted goes to the system sheet (save to Files, AirDrop, open in
     another app). The temporary copy is deleted once the sheet closes
     (`src/share.ts`).
4. It keeps the native chrome in step with the page's theme
   (`src/injected.ts`), and sends links out of the app to the system browser.

The page never asks whether it is inside the wrapper. It only checks whether
a capability is there (`apps/remote/src/hosts.ts`), so the same build works in
a browser, where it falls back to IndexedDB keys, pasting codes and
downloads.

## What breaks quietly

- **The bridge's names must match the page's and the framework's.** A
  mismatch shows no error: the page just finds no host and falls back.
  `apps/remote/tests/native_bridge_test.ts` pins every name and runs a
  request round trip against a fake page.
- **`src/bridge.ts` and `src/wire.ts` import nothing** (except each other).
  The storage repo's tests import them without Expo installed, so even a
  type-only import of a native module breaks CI. The same test reads their
  import lines.
- **The loopback port is fixed.** A web origin includes its port. A new port
  on every launch would hand the page an empty IndexedDB.
- **`localhost`, never `127.0.0.1`.** App Transport Security blocks the
  literal address in `WKWebView`.
- **The storage server needs a publicly trusted certificate** (`--tls acme`,
  `--tls files`, or a TLS-terminating proxy). ATS stays on for everything but
  the loopback page, and a WebView cannot pin the self-signed mode's
  fingerprint.
- **`native/ios` and `native/android` are prebuild output** (gitignored).
  Make fixes in `app.config.js`, not there.
- **`tsconfig.json` must not `extend` Expo's base.** See the comment in the
  file.

## Develop

```sh
make framework                    # at the repo root: the framework checkout the app builds against
cd apps/remote/native
npm install
npm run bundle                    # build apps/remote and pack assets/webroot.zip
npx expo prebuild --clean         # generate ios/ and android/
npx expo run:ios                  # or run:android
npm run typecheck
```

`EXPO_PUBLIC_REMOTE_URL=http://<lan-ip>:4175` points a debug build at
`npm run dev --workspace apps/remote` instead of the bundle.

`node scripts/generate-icons.mjs` redraws the icons (the console's mark in
its accent colour). The PNGs are committed.

## Release

Builds run on EAS. A deployment's name and identifiers are build variables
and are never committed, the same three as every wrapper in the fleet:

| Variable           | What it sets                                  |
| ------------------ | --------------------------------------------- |
| `APP_DISPLAY_NAME` | The listing name and the name under the icon  |
| `APP_BUNDLE_ID`    | The iOS bundle identifier and Android package |
| `EAS_PROJECT_ID`   | The Expo project the build belongs to         |

A `production` build refuses to start without them (`identifiers.js`).

```sh
npm run build:preview             # internal build (APK on Android)
npm run build:production          # store builds, both platforms
```

The app uses only the platform's own cryptography (WebCrypto in the
WebView, the Keychain / Keystore), so `ITSAppUsesNonExemptEncryption` is
`false`. Re-check the export-compliance answer if that ever changes.
