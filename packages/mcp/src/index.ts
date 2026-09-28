// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The MCP server as a library (tests, embedding) — the CLI is `storage-mcp`.

export {
  applyFlags,
  defaultConfig,
  GROUPS,
  loadConfig,
  parseConfig,
} from "./config.ts";
export type { Group, Level, McpConfig } from "./config.ts";
export {
  McpServer,
  LATEST_PROTOCOL,
  SUPPORTED_PROTOCOLS,
} from "./protocol/server.ts";
export { createMcp, serve } from "./serve.ts";
export { openSession } from "./session.ts";
export { ALL_TOOLS, toolsFor } from "./tools/index.ts";
export { VERSION } from "./version.ts";
