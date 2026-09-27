// Runs the examples from source with the same aliases as the e2e suite:
// the server, the testkit and the oss-framework client (OSS_FRAMEWORK_DIR).
import { defineConfig } from "vitest/config";

import { sharedConfig } from "../vitest.shared.ts";

export default defineConfig({
  ...sharedConfig,
  test: { ...sharedConfig.test, include: ["**/tests/**/*_test.ts"] },
});
