#!/usr/bin/env node
/**
 * @wippyapp/mcp — stdio MCP server for Wippy.
 *
 * Spawned by Claude Desktop (or any MCP client) as a subprocess. Reads
 * WIPPY_API_TOKEN from env, opens a stdio transport, and forwards tool
 * calls to https://wippy.app/api/mcp/* (or WIPPY_API_URL override).
 *
 * Critical: status messages go to stderr, NEVER stdout. stdout is the
 * MCP protocol channel — any extra bytes corrupt the JSON-RPC stream
 * and the client disconnects.
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createWippyMcpServer } from './server.js';

const SETUP_HINT = `
To use @wippyapp/mcp, set WIPPY_API_TOKEN to a Wippy personal access token.
Generate one at: https://wippy.app/account/api-tokens

Example claude_desktop_config.json:
{
  "mcpServers": {
    "wippy": {
      "command": "npx",
      "args": ["-y", "@wippyapp/mcp"],
      "env": {
        "WIPPY_API_TOKEN": "wpy_pat_..."
      }
    }
  }
}
`;

async function main(): Promise<void> {
  const apiToken = process.env.WIPPY_API_TOKEN;
  if (!apiToken) {
    console.error('ERROR: WIPPY_API_TOKEN environment variable is required.');
    console.error(SETUP_HINT);
    process.exit(1);
  }
  const apiUrl = process.env.WIPPY_API_URL;

  const server = createWippyMcpServer({ apiUrl, apiToken });
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Status to stderr — stdout is reserved for the MCP protocol.
  console.error(
    `@wippyapp/mcp running on stdio (target: ${apiUrl ?? 'https://wippy.app'})`,
  );
}

main().catch((err) => {
  console.error('Fatal error in @wippyapp/mcp:', err);
  process.exit(1);
});
