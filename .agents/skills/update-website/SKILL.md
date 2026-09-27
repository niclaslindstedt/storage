---
name: update-website
description: "Use when the marketing website may be stale. Discovers commits since the last website update and refreshes source-derived content under website/ so generated pages match the current README, docs, and spec."
---

# Updating the Website

**Governing spec sections:** §11.2 (`website/` — source-derived content, no double-authoring, staleness CI check), §21.5 (this skill is mandated when the project publishes a website).

The `website/` directory contains the showcase and hosted docs for `storage` (Vite + React, prerendered). Per §11.2 of `OSS_SPEC.md`, facts are never authored twice: `website/scripts/extract-source-data.mjs` reads them from source (at the latest `v*` tag for released facts, the working tree for docs and examples) into the gitignored `website/src/generated/sourceData.ts`. What this skill maintains is the hand-written part: the pitch and feature cards in `website/src/site.ts` and `website/src/components/Home.tsx`, and the extractor itself when a source marker moves.

## Tracking mechanism

`.agents/skills/update-website/.last-updated` contains the git commit hash from the last successful run. Empty means "never run" — fall back to the initial commit.

## Discovery process

1. Read the baseline:

   ```sh
   BASELINE=$(cat .agents/skills/update-website/.last-updated)
   ```

2. Diff sources of truth against the baseline:

   ```sh
   git log --oneline "$BASELINE"..HEAD -- docs/ examples/ packages/server/src CHANGELOG.md
   git diff --name-only "$BASELINE"..HEAD -- docs/ examples/ packages/server/src CHANGELOG.md
   ```

3. If anything changed, rebuild the website and inspect the diff under `website/`.

## Mapping table

| Changed file                                                        | Effect on website                                                            |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `docs/*.md` (added / renamed)                                       | Docs pages; add the slug to `DOC_ORDER` in the extractor                     |
| `examples/*/` (added / renamed)                                     | "See it work" tabs; update `EXAMPLES` in the extractor                       |
| `packages/server/src/cli/spec.ts`                                   | Command table, settings table, `llms.txt`                                    |
| `packages/server/src/config.ts` `TlsMode`, `DEFAULT_CONFIG`         | TLS table (`TLS_TEXT` in `Home.tsx` needs a line per mode), quick-start port |
| `packages/server/src/api/identity.ts` `CAPABILITIES`                | Capabilities list                                                            |
| Features added or removed (crypto, sharing, sync, hosting, testkit) | Feature cards in `Home.tsx`; pitch in `site.ts`                              |
| `CHANGELOG.md` release sections                                     | "What's new" block                                                           |
| `.nvmrc`                                                            | Hosts card, JSON-LD requirements                                             |

## Update checklist

- [ ] Read baseline and diff sources of truth
- [ ] Update the extractor, `site.ts` or `Home.tsx` per the mapping table
- [ ] `make website` (the extractor fails loudly on a moved marker)
- [ ] `cd website && npm run check:seo && npm run typecheck`
- [ ] `npm run preview` and look at `/storage/` and one doc page
- [ ] Run `bash scripts/validate.sh .`
- [ ] Write the new baseline:

      git rev-parse HEAD > .agents/skills/update-website/.last-updated

## Verification

1. Open the rendered site locally and verify hero copy, version, and key tables.
2. `npm run check:seo` reports 0 errors (the `seo` workflow runs the same check).
3. Confirm `.last-updated` was rewritten.

## Skill self-improvement

1. **Expand the mapping table** if a new source file started feeding the website.
2. **Record extraction quirks** (e.g. "anchor X is parsed from heading Y").
3. **Commit the skill edit** alongside the website update.
