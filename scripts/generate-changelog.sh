#!/usr/bin/env bash
# Regenerate CHANGELOG.md (Keep a Changelog) from the conventional commits
# between the previous v* tag and <tag>. The new section is inserted under
# the Unreleased heading; earlier sections are kept verbatim. The release
# workflow is the only writer — manual edits are rejected by
# scripts/check-changelog.sh (OSS_SPEC §8.4).
#
#   scripts/generate-changelog.sh <tag> [<date>]
set -euo pipefail

tag="${1:?usage: generate-changelog.sh <tag> [<date>]}"
date="${2:-$(date -u +%Y-%m-%d)}"
version="${tag#v}"
file=CHANGELOG.md

if grep -q "^## \[${version}\]" "$file"; then
  echo "generate-changelog: ${version} already present; nothing to do"
  exit 0
fi

ref="$tag"
git rev-parse -q --verify "refs/tags/${tag}" >/dev/null || ref=HEAD
prev=$(git tag -l 'v*' --sort=-v:refname --merged "$ref" | grep -vx "$tag" | head -n1 || true)
range="${prev:+${prev}..}${ref}"

declare -A groups=()
order=(Breaking Added Changed Fixed Security Removed)
while IFS= read -r subject; do
  [ -z "$subject" ] && continue
  if [[ "$subject" =~ ^([a-z]+)(\(([^\)]*)\))?(!)?:\ (.*)$ ]]; then
    type="${BASH_REMATCH[1]}"
    scope="${BASH_REMATCH[3]}"
    bang="${BASH_REMATCH[4]}"
    text="${BASH_REMATCH[5]}"
  else
    continue
  fi
  [ "$type" = chore ] && [[ "$scope" == release* ]] && continue
  line="- ${scope:+**${scope}:** }${text}"
  if [ -n "$bang" ]; then
    section=Breaking
  else
    case "$type" in
      feat) section=Added ;;
      fix) section=Fixed ;;
      perf | refactor) section=Changed ;;
      security) section=Security ;;
      revert) section=Removed ;;
      *) continue ;;
    esac
  fi
  groups[$section]+="${line}"$'\n'
done < <(git log --no-merges --format='%s' "$range")

entry="## [${version}] - ${date}"$'\n'
for section in "${order[@]}"; do
  if [ -n "${groups[$section]:-}" ]; then
    entry+=$'\n'"### ${section}"$'\n\n'"${groups[$section]}"
  fi
done
if [ "${#groups[@]}" -eq 0 ]; then
  entry+=$'\n'"Maintenance release; no user-facing changes."$'\n'
fi

tmp=$(mktemp)
awk -v entry="$entry" '
  { print }
  /^## \[Unreleased\]/ && !done { print ""; printf "%s", entry; done = 1 }
' "$file" >"$tmp"
mv "$tmp" "$file"
echo "generate-changelog: added ${version} (${range})"
