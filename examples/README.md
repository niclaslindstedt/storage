# Examples

Each example lives in its own directory with a README and is exercised by
`make examples` in CI, so none can silently rot.

| Example                            | What it shows                                                                                        |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------- |
| [node-quickstart](node-quickstart) | Pairing, one shared encrypted namespace, a row-level merge, and a server that holds only ciphertext. |
| [app-testing](app-testing)         | An app's tests against a real in-memory server: faults, clock, snapshots.                            |
| [home-server](home-server)         | Docker Compose for a home server with Let's Encrypt and UPnP port mapping.                           |

All of them need `make framework build` first.
