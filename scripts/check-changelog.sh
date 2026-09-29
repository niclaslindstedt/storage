#!/usr/bin/env bash
# Reject hand edits to CHANGELOG.md: only the release
# workflow's `chore(release): …` commit may touch it.
#
#   scripts/check-changelog.sh --staged        # pre-commit hook
#   scripts/check-changelog.sh <base-ref>      # CI: commits in base..HEAD
set -euo pipefail

mode="${1:?usage: check-changelog.sh --staged | <base-ref>}"

if [ "$mode" = "--staged" ]; then
  if git diff --cached --name-only --diff-filter=MD | grep -qx CHANGELOG.md &&
    [ "${ALLOW_CHANGELOG_EDIT:-}" != 1 ]; then
    echo "CHANGELOG.md is generated at release time; do not edit it by hand." >&2
    echo "(the release workflow regenerates it from conventional commits)" >&2
    exit 1
  fi
  exit 0
fi

status=0
while read -r sha; do
  [ -z "$sha" ] && continue
  subject=$(git log -1 --format=%s "$sha")
  [[ "$subject" == "chore(release):"* ]] && continue
  # Creating the file (the bootstrap commit) is allowed; editing it is not.
  if git diff-tree --no-commit-id --name-only --diff-filter=MD -r "$sha" | grep -qx CHANGELOG.md; then
    echo "::error file=CHANGELOG.md::commit ${sha:0:12} (\"${subject}\") edits CHANGELOG.md by hand"
    status=1
  fi
done < <(git rev-list "${mode}..HEAD")
exit "$status"
