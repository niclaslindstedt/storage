// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Platform-appropriate default locations (OSS_SPEC §19). The platform is a
// parameter so the CLI (and its tests) can pin it.

import { homedir, platform } from "node:os";
import { join } from "node:path";

export function defaultDataDir(
  env: NodeJS.ProcessEnv = process.env,
  os: NodeJS.Platform = platform(),
): string {
  if (env.STORAGE_DATA_DIR) return env.STORAGE_DATA_DIR;
  const home = homedir();
  if (os === "darwin")
    return join(home, "Library", "Application Support", "storage-server");
  if (os === "win32")
    return join(
      env.APPDATA ?? join(home, "AppData", "Roaming"),
      "storage-server",
    );
  return join(
    env.XDG_DATA_HOME ?? join(home, ".local", "share"),
    "storage-server",
  );
}

export function defaultLogFile(
  env: NodeJS.ProcessEnv = process.env,
  os: NodeJS.Platform = platform(),
): string {
  if (env.STORAGE_LOG_FILE) return env.STORAGE_LOG_FILE;
  const home = homedir();
  if (os === "darwin")
    return join(home, "Library", "Logs", "storage-server", "debug.log");
  if (os === "win32")
    return join(
      env.LOCALAPPDATA ?? join(home, "AppData", "Local"),
      "storage-server",
      "debug.log",
    );
  return join(
    env.XDG_STATE_HOME ?? join(home, ".local", "state"),
    "storage-server",
    "debug.log",
  );
}
