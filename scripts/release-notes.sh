#!/usr/bin/env bash
# Print the CHANGELOG.md section for <tag> (the lines between its heading
# and the next `## [` heading), for the GitHub Release body.
#
#   scripts/release-notes.sh <tag>
set -euo pipefail

tag="${1:?usage: release-notes.sh <tag>}"
version="${tag#v}"
awk -v v="$version" '
  $0 ~ "^## \\[" v "\\]" { on = 1; next }
  on && /^## \[/ { exit }
  on { print }
' CHANGELOG.md | sed -e '/./,$!d'
