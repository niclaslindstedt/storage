# Testing against the server

The server is designed to be the easiest backend to test against: it runs
in-process, starts in milliseconds, keeps everything in memory, and exposes
controls a real cloud never would.

## In-process (Vitest, Node)

```ts
import { startTestServer } from "@niclaslindstedt/storage-testkit";

const server = await startTestServer();
const alice = await server.createAccount("alice"); // { account, pairingUri, pairingCode }
// … pair your app's client with alice.pairingUri, run the scenario …
await server.close();
```

## As a process (Playwright, any language)

```sh
storage-server test-server --port 4010 --secret dev
# {"url":"http://127.0.0.1:4010","secret":"dev"}
```

or `startTestServerProcess()` from the testkit, which returns the same API.

## Controls (`/__test/*`, header `X-Test-Secret`)

| Call                                            | Effect                                                                                                                                                      |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /__test/accounts {name, role}`            | Create an account and a pairing code/URI                                                                                                                    |
| `POST /__test/faults {rules}`                   | Inject faults: `offline` (drop the connection), `status` (e.g. 503, 429 with `retryAfter`), `delay` — matched by method and path prefix, optionally `times` |
| `DELETE /__test/faults`                         | Clear faults                                                                                                                                                |
| `POST /__test/clock {advanceMs}`                | Move time (token expiry, invites, retention)                                                                                                                |
| `GET /__test/snapshot` / `POST /__test/restore` | Save and restore the whole server state                                                                                                                     |
| `POST /__test/reset`                            | Back to empty                                                                                                                                               |
| `POST /__test/retention`                        | Run housekeeping now                                                                                                                                        |

Test mode is off unless explicitly enabled and every call needs the per-run
secret; never enable it on a server that holds real data.

## Scenarios worth testing in an app

- Two devices edit the same row → both edits survive (row merge).
- A device goes offline mid-save (`offline` fault) → the save retries.
- `429` with `retryAfter` → the app backs off and shows "throttled".
- Token expiry (`clock`) → silent re-authentication.
- A member is removed → their device loses access; rotation re-encrypts.
