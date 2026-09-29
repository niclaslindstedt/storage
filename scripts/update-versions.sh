#!/usr/bin/env bash
# Set every shipped manifest and embedded version constant to <tag>'s
# version: the root and workspace package.json files (server, testkit,
# cli, mcp), every workspace's pin on a sibling package (the testkit's and
# the e2e suite's), package-lock.json, the server's VERSION constant (the
# CLI bundles it), the MCP server's, and the website. Idempotent.
#
# A pin left behind names a version no workspace carries, and npm then asks
# the registry for it, which fails for a version not published yet.
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
// Workspaces that pin the siblings but ship nothing, so keep their own version.
const pinsOnly = ["e2e/package.json"];
for (const file of [...files, ...pinsOnly]) {
  if (!fs.existsSync(file)) continue;
  const pkg = JSON.parse(fs.readFileSync(file, "utf8"));
  if (files.includes(file)) pkg.version = version;
  for (const field of ["dependencies", "devDependencies"]) {
    for (const name of Object.keys(pkg[field] ?? {})) {
      if (name.startsWith("@niclaslindstedt/storage-"))
        pkg[field][name] = version;
    }
  }
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
