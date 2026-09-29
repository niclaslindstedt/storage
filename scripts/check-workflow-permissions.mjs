#!/usr/bin/env node
// Least-privilege audit of .github/workflows: every
// workflow sets a top-level `permissions:` default, every job declares its
// own block, publish jobs carry `id-token: write`, and `contents: write` is
// only granted to jobs that push commits/tags or create a release.
// Line-based on purpose: the workflows are plain two-space YAML and the
// check must run with no dependencies.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const dir = ".github/workflows";
const PUBLISH = /npm publish|^\s*push: true|attest-build-provenance/m;
const WRITES_REPO = /git push|action-gh-release|gh release create/;
let failures = 0;
const fail = (file, msg) => {
  failures++;
  console.log(`::error file=${file}::${msg}`);
};

for (const name of readdirSync(dir).filter((f) => /\.ya?ml$/.test(f))) {
  const file = join(dir, name);
  const lines = readFileSync(file, "utf8").split("\n");
  if (!lines.some((l) => /^permissions:/.test(l)))
    fail(file, "missing top-level `permissions:` default");

  const start = lines.findIndex((l) => /^jobs:\s*$/.test(l));
  if (start < 0) continue;
  const jobs = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^\S/.test(line)) break;
    const m = line.match(/^ {2}([A-Za-z0-9_-]+):\s*$/);
    if (m) jobs.push({ name: m[1], body: [] });
    else if (jobs.length) jobs.at(-1).body.push(line);
  }
  for (const job of jobs) {
    const body = job.body.join("\n");
    const permStart = job.body.findIndex((l) => /^ {4}permissions:/.test(l));
    const perms = [];
    if (permStart >= 0) {
      for (const l of job.body.slice(permStart + 1)) {
        if (!/^ {6}/.test(l)) break;
        perms.push(l.trim());
      }
    }
    const where = `${file} job \`${job.name}\``;
    if (permStart < 0) {
      fail(file, `${where} has no job-level \`permissions:\` block`);
      continue;
    }
    if (
      PUBLISH.test(body) &&
      !perms.some((p) => p.startsWith("id-token: write"))
    )
      fail(file, `${where} publishes but lacks \`id-token: write\``);
    if (
      perms.some((p) => p.startsWith("contents: write")) &&
      !WRITES_REPO.test(body)
    )
      fail(
        file,
        `${where} has \`contents: write\` but never pushes or releases`,
      );
  }
}

if (failures) process.exit(1);
console.log("workflow permissions: ok");
