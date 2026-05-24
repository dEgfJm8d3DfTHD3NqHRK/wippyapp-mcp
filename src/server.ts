/**
 * Factory for the Wippy MCP server. Exported separately from index.ts
 * so tests can construct a server without invoking the stdio transport
 * (which would block on process.stdin).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WippyClient } from './client.js';
import { registerTools } from './tools.js';

export const PACKAGE_NAME = '@wippyapp/mcp';
// Keep in sync with package.json version. Drift would be a silent bug —
// the test in __tests__/server.test.ts catches it by reading package.json.
export const PACKAGE_VERSION = '0.1.0';

export interface WippyMcpServerConfig {
  apiUrl?: string;
  apiToken: string;
}

export function createWippyMcpServer(config: WippyMcpServerConfig): McpServer {
  const server = new McpServer({
    name: PACKAGE_NAME,
    version: PACKAGE_VERSION,
  });
  const client = new WippyClient(config);
  registerTools(server, client);
  return server;
}
