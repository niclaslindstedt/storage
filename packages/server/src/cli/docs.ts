// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The repository's docs/ topics, compiled into the binary (OSS_SPEC §12.3):
// the bundler inlines each Markdown file as a string.

import adminConsole from "../../../../docs/admin-console.md";
import architecture from "../../../../docs/architecture.md";
import configuration from "../../../../docs/configuration.md";
import gettingStarted from "../../../../docs/getting-started.md";
import homeHosting from "../../../../docs/home-hosting.md";
import protocol from "../../../../docs/protocol.md";
import remoteApp from "../../../../docs/remote-app.md";
import security from "../../../../docs/security.md";
import sharing from "../../../../docs/sharing.md";
import testing from "../../../../docs/testing.md";
import troubleshooting from "../../../../docs/troubleshooting.md";

export const DOC_TOPICS: Record<string, string> = {
  "getting-started": gettingStarted,
  configuration,
  "home-hosting": homeHosting,
  "admin-console": adminConsole,
  "remote-app": remoteApp,
  security,
  sharing,
  protocol,
  architecture,
  testing,
  troubleshooting,
};
