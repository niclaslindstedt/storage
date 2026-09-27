# Testing an app against the server

[`tests/medications_test.ts`](tests/medications_test.ts) is the shape an
app's own tests take: a fresh in-memory server per test (it starts in
milliseconds), a paired, keyed client in one call, and test controls that a
hosted backend never offers.

```sh
make framework build
npm run --prefix examples/app-testing start
```

- `server.faults.status(503, { path, times })` — make the next request fail.
- `server.faults.offline({ path })` — drop connections.
- `server.clock.advance(ms)` — expire tokens, invites and trash without
  waiting.
- `server.snapshot()` / `server.restore(snap)` — capture and replay server
  state; a paired device detects the replay as a rollback, which the example
  asserts.
- `server.reset()` — back to an empty server between cases.

For browser tests, run `storage-server test-server --secret <s>` and drive
it over HTTP with `connectTestServer(url, secret)`; the reference app's
Playwright suite does exactly that. See [docs/testing.md](../../docs/testing.md).
