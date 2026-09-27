# Node quickstart

Two people share **one** end-to-end encrypted namespace, edit the same row
concurrently, and get a row-level merge — against a real server running
in-memory, in about a second.

```sh
make framework build            # once: clone oss-framework, build the server
npm run --prefix examples/node-quickstart start
```

What it shows, in [`main.ts`](main.ts):

1. Pairing a device from a pairing QR payload and creating the account keys
   (the recovery key is printed once and never stored on the server).
2. Creating a namespace and writing an encrypted record.
3. Inviting someone to that namespace only; they join as a guest.
4. Concurrent edits to different fields of one row, merged on sync.
5. A server snapshot that contains no plaintext.

The same client code runs in a browser; see
[`apps/reference`](../../apps/reference) for a React app.
