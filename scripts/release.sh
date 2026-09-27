#!/usr/bin/env bash
# Compute the next version from the conventional-commit history since the
# last v* tag (or force patch/minor/major), then create and push a
# lightweight vX.Y.Z tag on main. Tag-only: the release workflow owns the
# changelog and manifest updates (OSS_SPEC §10.3). The version-bump workflow
# runs this; maintainers can run it locally as a break-glass procedure.
#
#   scripts/release.sh [auto|patch|minor|major] [--no-push]
set -euo pipefail

bump="${1:-auto}"
push=1
[ "${2:-}" = "--no-push" ] && push=0

branch=$(git rev-parse --abbrev-ref HEAD)
if [ "$branch" != "main" ]; then
  echo "release.sh: must run on main (on ${branch})" >&2
  exit 1
fi
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "release.sh: working tree is not clean" >&2
  exit 1
fi

last=$(git tag -l 'v*' --sort=-v:refname | head -n1)
current="${last#v}"
current="${current:-0.0.0}"
IFS=. read -r major minor patch <<<"$current"
range="${last:+${last}..}HEAD"

if [ "$bump" = "auto" ]; then
  subjects=$(git log --format='%s' "$range")
  bodies=$(git log --format='%b' "$range")
  if grep -qE '^[a-z]+(\([^)]*\))?!:' <<<"$subjects" ||
    grep -q '^BREAKING CHANGE:' <<<"$bodies"; then
    bump="major"
  elif grep -qE '^feat(\([^)]*\))?:' <<<"$subjects"; then
    bump="minor"
  else
    bump="patch"
  fi
  # Pre-1.0 a breaking change bumps minor (semver §4).
  if [ "$major" = "0" ] && [ "$bump" = "major" ]; then bump="minor"; fi
fi

case "$bump" in
  major) major=$((major + 1)); minor=0; patch=0 ;;
  minor) minor=$((minor + 1)); patch=0 ;;
  patch) patch=$((patch + 1)) ;;
  *) echo "release.sh: unknown bump: $bump" >&2; exit 1 ;;
esac

version="${major}.${minor}.${patch}"
tag="v${version}"
if git rev-parse -q --verify "refs/tags/${tag}" >/dev/null; then
  echo "release.sh: tag ${tag} already exists" >&2
  exit 1
fi

git tag "$tag"
if [ "$push" = 1 ]; then git push origin "$tag"; fi
echo "version=${version}" >>"${GITHUB_OUTPUT:-/dev/null}"
echo "tagged ${tag} (${bump})"
