// Browser tests of the admin console (SPEC §11.1) against the built server:
// `storage-server serve` on a throwaway data directory, plain HTTP, the
// device API on :4030 and the console on :4031.

import { defineConfig, devices } from "@playwright/test";

export const API_URL = "http://127.0.0.1:4030";
export const CONSOLE_URL = "http://127.0.0.1:4031";
export const DATA_DIR = ".admin-e2e";

export default defineConfig({
  testDir: "browser-tests",
  testMatch: /.*_test\.ts$/,
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: CONSOLE_URL,
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
  },
  webServer: {
    command: `rm -rf ${DATA_DIR} && node dist/cli.js serve --data-dir ${DATA_DIR} --name e2e-home --tls off --host 127.0.0.1 --port 4030 --admin-port 4031`,
    url: `${API_URL}/v1/info`,
    reuseExistingServer: false,
    env: { STORAGE_LOG_FILE: `${DATA_DIR}/debug.log` },
  },
});
