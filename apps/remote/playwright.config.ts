// Playwright drives Storage Remote against a real storage server in test
// mode (`storage-server test-server`, in-memory, with the remote console
// mounted) and the Vite dev server. Each browser context is one phone.

import { defineConfig, devices } from "@playwright/test";

export const SERVER_URL = "http://127.0.0.1:4011";
export const TEST_SECRET = "remote-e2e";

export default defineConfig({
  testDir: "browser-tests",
  testMatch: /.*_test\.ts$/,
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: "http://localhost:4175",
    trace: "retain-on-failure",
    ...devices["Pixel 7"],
  },
  webServer: [
    {
      command: `node ../../packages/server/dist/cli.js test-server --port 4011 --secret ${TEST_SECRET}`,
      url: `${SERVER_URL}/v1/info`,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: "npx vite --port 4175 --strictPort",
      url: "http://localhost:4175",
      reuseExistingServer: !process.env.CI,
    },
  ],
});
