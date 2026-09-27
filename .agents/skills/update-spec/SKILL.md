---
name: update-spec
description: "Use when SPEC.md may no longer describe the implementation. Discovers commits since the last spec update, maps changed server, framework and testkit code to SPEC.md sections, and brings the design spec and its progress checklist back into sync."
---

# Updating SPEC.md

**Governing spec sections:** §21.5 (project-specific drift-prone artifacts get their own skill; `update-spec` is the example the spec names), §7 (AGENTS.md points agents at `SPEC.md` as the design record).

`SPEC.md` is the design specification for storage: decisions (§0), the security and crypto model (§4), the HTTP API (§6), conflict handling (§7), the client (§8), payload formats (§9), TLS and networking (§10), the CLI (§11), the testkit (§12) and the progress checklist (§15). It is how interrupted work resumes, so it must describe what the code does — not what was planned. It drifts whenever an endpoint, a wire format, a crypto binding or a default changes without a matching edit.

## Tracking mechanism

`.agents/skills/update-spec/.last-updated` contains the git commit hash from the last successful run. Empty means "never run" — fall back to the repository's initial commit.

## Discovery process

1. Read the baseline:

   ```sh
   BASELINE=$(cat .agents/skills/update-spec/.last-updated)
   ```

2. List commits and changed files since the baseline:

   ```sh
   git log --oneline "$BASELINE"..HEAD
   git diff --name-only "$BASELINE"..HEAD -- packages/ e2e/ apps/ Dockerfile e2e/framework-ref
   ```

3. For client-side changes, diff the framework at the pinned ref too:

   ```sh
   git -C "${OSS_FRAMEWORK_DIR:-../oss-framework}" log --oneline -20 -- src/storage/selfhosted src/qr
   ```

4. Categorize using the mapping table below.

## Mapping table

| Changed files / scope                                                                        | SPEC.md section(s) to update                                                                       |
| -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `packages/server/src/api/**`, `http/router.ts`, `http/handler.ts`                            | §6 API (routes, headers, status codes, rate limits)                                                |
| `packages/server/src/services/**`                                                            | §6 and the behaviour notes of the matching subsection; §7 for revisions / tombstones / change feed |
| `packages/server/src/crypto.ts`, framework `selfhosted/crypto.ts`, `rotation.ts`, `vault.ts` | §4 security and crypto (envelopes, AAD bindings, key hierarchy, storage of keys)                   |
| `packages/server/src/payload.ts`, framework `selfhosted/payload.ts`                          | §9 payloads (QR / pairing / invite formats)                                                        |
| `packages/server/src/db/schema.ts`                                                           | §5 data model                                                                                      |
| framework `selfhosted/record-store.ts`, `merge.ts`, `row-document.ts`, `adapters.ts`         | §7 conflicts, §8 client                                                                            |
| `packages/server/src/tls/**`, `net/**`                                                       | §10 TLS and networking                                                                             |
| `packages/server/src/cli/spec.ts`                                                            | §11 CLI                                                                                            |
| `packages/testkit/src/**`, `api/testing.ts`                                                  | §12 testkit                                                                                        |
| Anything finished or started                                                                 | §15 progress checklist (`[x]` only when implemented **and** tested)                                |

## Update checklist

- [ ] Read baseline from `.last-updated` and run `git log` / `git diff --name-only`
- [ ] Read the affected SPEC.md sections and the changed code side by side
- [ ] Correct every statement the code contradicts; record new decisions in §0
- [ ] Update §15: tick finished items, add items for new work
- [ ] Keep the wire formats exact (byte layouts, header names, error codes)
- [ ] Run `make test` — the e2e suite is the executable form of the spec
- [ ] Write the new baseline:

      git rev-parse HEAD > .agents/skills/update-spec/.last-updated

## Verification

1. Every endpoint in `packages/server/src/api/*.ts` appears in §6 with the same method and path.
2. Every §15 item marked `[x]` has code and a test behind it.
3. Confirm `.last-updated` was rewritten.

## Skill self-improvement

1. **Grow the mapping table** with any new source → SPEC section relationship.
2. **Record recurring corrections** (e.g. a format that keeps drifting) as a note here.
3. **Commit the skill edit** alongside the SPEC.md change.
