---
name: update-manpages
description: "Use when files under man/ may be stale. Discovers commits since the last manpage update, maps changed CLI definitions to affected pages, and updates man/<cmd>.md to match the current implementation."
---

# Updating the Manpages

**Governing spec sections:** §12.3 (`docs` and `man` commands — every CLI subcommand must have a `man/<cmd>.md` page exposed through `<project> man <cmd>`), §12.5 (discoverability contract), §21.5 (this skill is mandated because `man/` is a drift-prone artifact in every CLI project).

`man/` contains the reference-style command documentation shipped with storage — one markdown file per command. These pages are the authoritative command-level reference and rot whenever a flag, subcommand, or default changes without a matching edit.

## Tracking mechanism

`.agents/skills/update-manpages/.last-updated` contains the git commit hash from the last successful run. Empty means "never run" — fall back to the repository's initial commit.

## Discovery process

1. Read the baseline:

   ```sh
   BASELINE=$(cat .agents/skills/update-manpages/.last-updated)
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

| Changed files / scope                                                 | Manpage(s) to update                         |
| --------------------------------------------------------------------- | -------------------------------------------- |
| `packages/server/src/cli/spec.ts` `COMMANDS` (new/renamed command)    | `man/<cmd>.md` (generated)                   |
| `spec.ts` flags, `GLOBAL_FLAGS`, `SERVER_FLAGS`, examples, exit codes | every `man/*.md` that lists them (generated) |
| `packages/server/src/cli/render.ts` `renderMan`                       | all of `man/`                                |

Pages are **generated**, never hand-edited: `make man` runs
`packages/server/scripts/gen-man.ts`, which renders each command from
`spec.ts`. CI regenerates them and fails on any diff, and
`packages/server/tests/cli_test.ts` snapshots the `--help-agent`,
`--debug-agent` and `man` output. Fix the spec, then regenerate.

Extend this table every time you find a new source file that feeds the manpages.

## Format conventions

Owned by `renderMan` in `packages/server/src/cli/render.ts`: H1 is
`storage-server-<cmd>(1)`, then Synopsis, Description, Flags, Examples, Exit
codes, See also. Change the renderer, not the pages.

## Update checklist

- [ ] Read baseline from `.last-updated` and run `git log` / `git diff --name-only`
- [ ] Read `packages/server/src/cli/spec.ts` for the current definitions
- [ ] Run `make man` and review `git diff man/`
- [ ] Update `cli_test.ts` snapshots only when the change is intended (`npx vitest -u` in `packages/server`)
- [ ] Run `make test` — the CLI snapshot and parity tests must pass
- [ ] Write the new baseline:

      git rev-parse HEAD > .agents/skills/update-manpages/.last-updated

## Verification

1. `make build`, then `node packages/server/dist/cli.js man <cmd>` for every changed page.
2. Compare every flag block against the CLI parser source.
3. Confirm `.last-updated` was rewritten.

## Skill self-improvement

1. **Grow the mapping table** with any new source → manpage relationship you discovered.
2. **Record format quirks** (e.g. alignment rules) you had to normalize.
3. **Commit the skill edit** alongside the manpage edits.
