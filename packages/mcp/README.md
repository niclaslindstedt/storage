# @niclaslindstedt/storage-mcp

An [MCP](https://modelcontextprotocol.io) server that lets an AI agent use
your self-hosted, end-to-end encrypted [storage server](../../README.md):
files and app data, sharing, devices and the admin console — as an _agent
device_ the server holds to the permissions and apps you grant.

```sh
# On the server's machine: an agent that may read the drive
storage-server pair --account <you> --agent --perms data:read --apps drive

# Where the agent runs
npm install -g @niclaslindstedt/storage-mcp
storage-mcp pair 'oss-storage://pair?v=1&s=…'
claude mcp add storage -- storage-mcp serve
```

- **Scoped by the server.** Permissions (`data:read`, `data:write`,
  `sharing`, `devices`, `console:read`, `console:write`) and apps are
  enforced on every request; they can be narrowed, never widened.
- **You choose what the agent sees.** `config.json` and `serve` flags turn
  groups of tools off or read-only, deny single tools, limit apps and
  folders.
- **A person confirms.** Deleting, sharing, account changes and new
  credentials are confirmed in your MCP client (elicitation), not by the
  model. Approving a device needs the safety code typed by you.
- **Secrets stay out of the model's context.** Pairing codes, invites and
  recovery keys go to a private file.
- **Untrusted content is fenced**, names are cleaned, reads are capped.
- **One server, over TLS**, with certificate pinning for self-signed
  servers; stdio only, no listening port.
- **Keys in an encrypted vault** (key file or passphrase), 0600.
- **Everything is audited**, locally and in the server's audit chain.
- **No runtime dependencies.**

MCP 2026-07-28 and 2024-11-05 … 2025-11-25, over stdio.

Full documentation: [docs/mcp.md](../../docs/mcp.md) (also
`storage-server docs mcp`).
