/**
 * Tool registry — the contract between the MCP protocol layer and the
 * Wippy backend routes. Each tool maps 1:1 to a /api/mcp/<route>.
 *
 * TOOL_DEFINITIONS is exported separately from registerTools() so the
 * shape can be unit-tested (route names, no collisions, schema present)
 * without bootstrapping the MCP SDK transport layer.
 *
 * Naming: MCP tool names use snake_case (Claude clients prefer it); the
 * matching backend routes use kebab-case (REST convention). The mapping
 * lives here.
 */
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { WippyClient } from './client.js';

/**
 * The raw-shape `inputSchema` is what the v1 SDK `server.tool(...)` API
 * expects (object of field → zod schema, not wrapped in `z.object(...)`).
 * v2 changes this shape; see migration notes in the README.
 */
type RawShape = Record<string, z.ZodTypeAny>;

export interface ToolDef {
  /** MCP tool name (snake_case, surfaced to Claude clients). */
  name: string;
  /** Human-readable description shown to Claude when picking tools. */
  description: string;
  /** Raw-shape Zod input schema, passed to server.tool(). */
  inputSchema: RawShape;
  /** Backend route segment under /api/mcp/ (kebab-case). */
  backendRoute: string;
}

export const TOOL_DEFINITIONS: readonly ToolDef[] = [
  {
    name: 'lookup_client',
    description:
      'Look up a CPA practice client by name (case-insensitive substring match). Returns up to 5 matching active clients with their recent returns. Use this to find a specific client before drilling into their returns or deadlines.',
    inputSchema: {
      name: z
        .string()
        .min(1)
        .max(200)
        .describe('Client name to search for (case-insensitive substring match).'),
    },
    backendRoute: 'lookup-client',
  },
  {
    name: 'get_return_status',
    description:
      "Get tax return status for a specific client and optional tax year. Returns up to 10 most recent returns sorted by tax year (newest first). Useful for queries like \"what's the status of the Jones 2025 return?\"",
    inputSchema: {
      clientName: z
        .string()
        .min(1)
        .max(200)
        .describe('Client name (case-insensitive substring match).'),
      taxYear: z
        .number()
        .int()
        .min(2000)
        .max(2100)
        .optional()
        .describe('Tax year (e.g., 2025). Omit to return all years.'),
    },
    backendRoute: 'return-status',
  },
  {
    name: 'get_upcoming_deadlines',
    description:
      'List tax return deadlines due in the next N days (1-180, default 30), using each return\'s real deadline: the extension date when the return is extended, moved to the next business day when it falls on a weekend or federal holiday. Leaves out filed, dropped and deleted-client returns; keeps Ready to Efile returns (prepared but not filed). Set include_past_due to also list every return past its deadline and not filed (any tax year), each flagged pastDue with daysPast. `count` is the total that matched; at most 30 rows come back (`returned`, `truncated`). Useful for queries like "what\'s due this week?" or "what\'s overdue?"',
    inputSchema: {
      days: z
        .number()
        .int()
        .min(1)
        .max(180)
        .default(30)
        .describe('Look-ahead window in days (1-180, default 30).'),
      include_past_due: z
        .boolean()
        .default(false)
        .describe(
          'Also include returns already past their deadline and not yet filed (any tax year). Default false = upcoming only.',
        ),
    },
    backendRoute: 'upcoming-deadlines',
  },
  {
    name: 'search_practice',
    description:
      'Full-text search across clients, entities, and returns in the firm. Returns up to 10 of each type matching the query (name/email/phone for clients, name/EIN for entities, client-name/entity-type/assignee for returns). Useful for general "find anything matching X" queries.',
    inputSchema: {
      query: z
        .string()
        .min(1)
        .max(200)
        .describe(
          'Search query (case-insensitive substring match across name, email, phone, EIN, assignee).',
        ),
    },
    backendRoute: 'search',
  },
  {
    name: 'get_dashboard_stats',
    description:
      'Get aggregate firm-wide dashboard stats: total active clients, active returns (not yet efiled/finalized), total returns by status, total billed amount. No parameters — returns a single snapshot.',
    inputSchema: {},
    backendRoute: 'dashboard-stats',
  },
] as const;

/**
 * Bind the tool definitions to an McpServer instance. Each tool's
 * handler delegates to the WippyClient — the MCP layer never builds
 * URLs or attaches auth headers itself.
 */
export function registerTools(server: McpServer, client: WippyClient): void {
  for (const def of TOOL_DEFINITIONS) {
    server.tool(
      def.name,
      def.description,
      def.inputSchema,
      async (args: Record<string, unknown>) => {
        const result = await client.callTool(def.backendRoute, args);
        // MCP content blocks must be text/image/resource. We JSON-stringify
        // the structured result so the Claude client can render or parse it.
        // Pretty-printed for human readability in Claude's tool-call view.
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        };
      },
    );
  }
}
