---
name: update-docs
description: "Use when files under docs/ may be stale. Discovers commits since the last docs update, maps changed source files to affected conceptual documentation, and brings docs/*.md back into sync."
---

# Updating the Docs

The `docs/` directory contains conceptual documentation for storage. Unlike the README (overview) or man pages (command reference), `docs/` explains _why_ and _how_ in depth. It goes stale whenever a user-visible behavior, configuration key, or supported surface changes without a matching edit.

## Tracking mechanism

`.agents/skills/update-docs/.last-updated` contains the git commit hash from the last successful run. Empty means "never run" — fall back to the repository's initial commit.

## Discovery process

1. Read the baseline:

   ```sh
   BASELINE=$(cat .agents/skills/update-docs/.last-updated)
   ```

2. List commits since the baseline:

   ```sh
   git log --oneline "$BASELINE"..HEAD
   ```

3. List changed files:

   ```sh
   git diff --name-only "$BASELINE"..HEAD
   ```

4. Categorize using the mapping table below.

## Mapping table

| Changed files / scope                                                                                    | Doc(s) to update                                               |
| -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `packages/server/src/api/**`, `packages/server/src/services/**` (routes, status codes, headers)          | `docs/protocol.md`                                             |
| `packages/server/src/cli/spec.ts` `SERVER_FLAGS`, `packages/server/src/config.ts`                        | `docs/configuration.md`                                        |
| `packages/server/src/crypto.ts`, framework `src/storage/selfhosted/crypto.ts`, `vault.ts`, `rotation.ts` | `docs/security.md`                                             |
| `services/invites.ts`, `services/namespaces.ts` (roles, members, rotation)                               | `docs/sharing.md`, `docs/security.md`                          |
| `packages/server/src/tls/**`, `net/**`, `cli/commands/ops.ts` (`doctor`, `upnp`, `cert`)                 | `docs/home-hosting.md`, `docs/troubleshooting.md`              |
| `packages/testkit/src/**`, `api/testing.ts`                                                              | `docs/testing.md`                                              |
| `packages/server/src/admin/**` (console pages, API, checks, metrics, auth)                               | `docs/admin-console.md`; checks also `docs/troubleshooting.md` |
| `Dockerfile`, `compose.yaml`, `.nvmrc`, install steps                                                    | `docs/getting-started.md`, `docs/home-hosting.md`              |
| New module or data flow (`app.ts`, `db/schema.ts`, blob store)                                           | `docs/architecture.md`                                         |
| Error codes (`packages/server/src/errors.ts`)                                                            | `docs/protocol.md`, `docs/troubleshooting.md`                  |

The website renders `docs/` verbatim (`website/scripts/extract-source-data.mjs`);
a new doc must also be added to `DOC_ORDER` there, or the website build fails.

Extend this table every time you find a new source file that feeds the docs.

## Update checklist

- [ ] Read baseline from `.last-updated` and run `git log` / `git diff --name-only`
- [ ] Read every affected `docs/*.md` file
- [ ] Walk the mapping table and update each doc in place
- [ ] Verify cross-links between docs still resolve
- [ ] Verify every shell example is still syntactically valid
- [ ] Run `make test` and `make website`
- [ ] Write the new baseline:

      git rev-parse HEAD > .agents/skills/update-docs/.last-updated

## Verification

1. Re-read every edited doc section against the current source of truth.
2. Click every internal cross-link and confirm the target still exists.
3. Confirm `.last-updated` was rewritten.

## Skill self-improvement

1. **Grow the mapping table** with any new source → doc relationship you discovered.
2. **Record recurring patterns** you had to invent.
3. **Commit the skill edit** alongside the docs change so the knowledge compounds.
