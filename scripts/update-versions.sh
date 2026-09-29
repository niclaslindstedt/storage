#!/usr/bin/env bash
# Set every shipped manifest and embedded version constant to <tag>'s
# version: the root and workspace package.json files (server, testkit,
# cli, mcp), the testkit's pinned server dependency, package-lock.json, the
# server's VERSION constant (the CLI bundles it), the MCP server's, and the
# website. Idempotent.
#
#   scripts/update-versions.sh <tag>
set -euo pipefail

tag="${1:?usage: update-versions.sh <tag>}"
version="${tag#v}"

node - "$version" <<'JS'
const fs = require("node:fs");
const version = process.argv[2];
const files = [
  "package.json",
  "packages/server/package.json",
  "packages/testkit/package.json",
  "packages/cli/package.json",
  "packages/mcp/package.json",
  "website/package.json",
];
for (const file of files) {
  if (!fs.existsSync(file)) continue;
  const pkg = JSON.parse(fs.readFileSync(file, "utf8"));
  pkg.version = version;
  if (pkg.dependencies?.["@niclaslindstedt/storage-server"])
    pkg.dependencies["@niclaslindstedt/storage-server"] = version;
  fs.writeFileSync(file, JSON.stringify(pkg, null, 2) + "\n");
}
for (const ts of [
  "packages/server/src/version.ts",
  "packages/mcp/src/version.ts",
]) {
  fs.writeFileSync(
    ts,
    fs
      .readFileSync(ts, "utf8")
      .replace(/VERSION = "[^"]*"/, `VERSION = "${version}"`),
  );
}
JS

npm install --package-lock-only --ignore-scripts --no-audit --no-fund >/dev/null
echo "update-versions: ${version}"
