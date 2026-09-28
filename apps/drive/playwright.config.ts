// Playwright drives the web drive against a real storage server in test
// mode (`storage-server test-server`, in-memory) and the Vite dev server.
// Each browser context is one browser signed in to the account.

import { defineConfig, devices } from "@playwright/test";

export const SERVER_URL = "http://127.0.0.1:4012";
export const TEST_SECRET = "drive-e2e";

export default defineConfig({
  testDir: "browser-tests",
  testMatch: /.*_test\.ts$/,
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: "http://localhost:4176",
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
  },
  webServer: [
    {
      command: `node ../../packages/server/dist/cli.js test-server --port 4012 --secret ${TEST_SECRET}`,
      url: `${SERVER_URL}/v1/info`,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: "npx vite --port 4176 --strictPort",
      url: "http://localhost:4176",
      reuseExistingServer: !process.env.CI,
    },
  ],
});
