// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Builds Storage Remote (apps/remote) and packs its `dist/` into one asset —
// `native/assets/webroot.zip` — that the wrapper bundles, unpacks on first
// launch and serves over a loopback HTTP server (src/local-server.ts). The
// web build is the same one the browser runs; nothing in it knows about the
// wrapper.
//
// Usage:
//   node scripts/bundle-web.mjs                 # build the app, then zip it
//   node scripts/bundle-web.mjs --skip-build    # re-zip an existing dist/
//   node scripts/bundle-web.mjs --profile production
//
// The build needs the oss-framework checkout the storage repo builds against
// (`make framework` at the repo root). The zip is a build artifact
// (gitignored); generate it before `eas build`.

import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { zipSync } from "fflate";

const NATIVE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const APP_DIR = resolve(NATIVE_DIR, "..");
const REPO_DIR = resolve(APP_DIR, "..", "..");
const DIST_DIR = join(APP_DIR, "dist");
const OUT_ZIP = join(NATIVE_DIR, "assets", "webroot.zip");
const WINDOWS = process.platform === "win32";
const NPM = WINDOWS ? "npm.cmd" : "npm";

const skipBuild = process.argv.includes("--skip-build");
const profileArg = process.argv.indexOf("--profile");
const profile =
  (profileArg >= 0 ? process.argv[profileArg + 1] : undefined) ??
  process.env.EAS_BUILD_PROFILE ??
  "preview";

if (!skipBuild) {
  console.log(`• building Storage Remote (apps/remote) — profile ${profile}…`);
  execFileSync(NPM, ["run", "build", "--workspace", "apps/remote"], {
    cwd: REPO_DIR,
    stdio: "inherit",
    shell: WINDOWS,
  });
}

function collect(dir, files = {}) {
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    if (statSync(abs).isDirectory()) collect(abs, files);
    else
      files[relative(DIST_DIR, abs).split("\\").join("/")] = new Uint8Array(
        readFileSync(abs),
      );
  }
  return files;
}

let files;
try {
  files = collect(DIST_DIR);
} catch (error) {
  console.error(
    `\n✗ could not read ${DIST_DIR} — build the app first (drop --skip-build).\n`,
  );
  throw error;
}
const count = Object.keys(files).length;
if (count === 0 || !files["index.html"])
  throw new Error(`dist/ has no index.html (${count} files).`);

// Deterministic zip: every entry pinned to the ZIP epoch.
const zipped = zipSync(files, { mtime: new Date("1980-01-01T00:00:00Z") });
mkdirSync(dirname(OUT_ZIP), { recursive: true });
writeFileSync(OUT_ZIP, zipped);
console.log(
  `✓ wrote ${OUT_ZIP} — ${count} files, ${(zipped.length / 1024).toFixed(0)} KB`,
);
