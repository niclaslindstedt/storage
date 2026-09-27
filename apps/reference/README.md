# Reference app

A small PWA on the self-hosted storage backend
(`@niclaslindstedt/oss-framework/storage` → `storage-server`), built to be
**tested end to end**. It exercises every capability on one page — pairing,
the recovery key, device approval with safety codes, namespaces, encrypted
notes (files) with conflict resolution, a live-synced to-do list (rows),
sharing one namespace with a guest, key rotation on removal — and shows an
event log of what happened.

## Run it

```sh
make framework                          # clone oss-framework next to this repo (once)
npm run build -w packages/server
node packages/server/dist/cli.js test-server --port 4010 --secret dev
npm run dev -w apps/reference           # http://localhost:4173
```

Seed an account and paste its pairing code into the app:

```sh
curl -s -X POST http://127.0.0.1:4010/__test/accounts \
  -H 'X-Test-Secret: dev' -H 'Content-Type: application/json' \
  -d '{"name":"alice"}' | jq -r .pairingUri
```

## Designed for tests

- Every control has a stable `data-testid`; lists expose `data-*` attributes
  (`data-title`, `data-done`, `data-name`, `data-path`) for precise locators.
- Each browser context is a separate device (its own IndexedDB key vault);
  `?profile=<name>` gives a second device inside one context.
- QR payloads are also shown as text, and app links (`/#oss=…`) prefill the
  connect form, so tests hand codes between devices without a camera.
- The event log (`data-testid="log-entry"`, `data-kind`) records pairing,
  saves, conflicts and errors.

## Playwright

```sh
npm run test:e2e -w apps/reference
```

`playwright.config.ts` starts `storage-server test-server` and Vite. The
tests use `connectTestServer()` from `@niclaslindstedt/storage-testkit` to
seed accounts, reset between tests and inject faults (offline, 503, 429).
