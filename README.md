# @wippyapp/mcp

MCP server for [Wippy](https://wippy.app) — query your CPA practice data via Claude (Desktop, Code, or any MCP client).

## What it does

Exposes 5 read-only tools backed by the Wippy API. Once installed, Claude can answer questions like *"who are my Smith clients?"*, *"what's due this week?"*, or *"how many active returns do I have?"* directly against your firm's data.

| MCP tool | What it returns |
|---|---|
| `lookup_client` | Up to 5 active clients matching a name, with their recent returns |
| `get_return_status` | Up to 10 returns for a client (optionally filtered by tax year) |
| `get_upcoming_deadlines` | Filing deadlines in the next N days (1-180, default 30) |
| `search_practice` | Full-text search across clients, entities, and returns |
| `get_dashboard_stats` | Firm-wide snapshot: active clients, active returns, returns by status, total billed |

All tools are firm-scoped, audit-logged, and read-only. The Wippy backend applies a per-token rate limit of 1000 calls per 24 hours.

## Setup

### 1. Generate a Wippy API token

Visit **<https://wippy.app/account/api-tokens>** and click **Create token**. Copy the token immediately — it's shown once, then only its hash is stored. The token looks like `wpy_pat_42_<long-secret>`.

### 2. Add to Claude Desktop

Edit your Claude Desktop config:

- **macOS** — `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows** — `%APPDATA%\Claude\claude_desktop_config.json`

```json
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
```

Restart Claude Desktop. The 5 Wippy tools appear in the tool list (look for the hammer icon in the chat).

### 3. Add to Claude Code

```bash
claude mcp add wippy -- npx -y @wippyapp/mcp
```

Then set the token:

```bash
export WIPPY_API_TOKEN="wpy_pat_..."
```

## Example queries

- *"Who are my Smith clients?"* → `lookup_client { name: "Smith" }`
- *"What's the status of John Smith's 2025 1040?"* → `get_return_status { clientName: "Smith", taxYear: 2025 }`
- *"What deadlines are coming up in the next 14 days?"* → `get_upcoming_deadlines { days: 14 }`
- *"Search my practice for anything matching Acme"* → `search_practice { query: "Acme" }`
- *"How many active returns and clients do I have right now?"* → `get_dashboard_stats {}`

Claude chooses which tool to call based on the question; you don't need to invoke them manually.

## Environment variables

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `WIPPY_API_TOKEN` | yes | — | Personal access token from `/account/api-tokens` |
| `WIPPY_API_URL` | no | `https://wippy.app` | Override the API base URL (staging / local dev) |

## Troubleshooting

### "Wippy API token was rejected"

The token is invalid, revoked, or has a typo. Visit <https://wippy.app/account/api-tokens> to generate a new one and update your config. (Old tokens can't be re-shown; you have to create a new one.)

### "Token lacks required scope: mcp:read"

The token was minted without the `mcp:read` scope. Create a new token — the default checkbox should already be selected; if you unchecked it, recreate with the box checked.

### "Cannot reach Wippy API"

Network connectivity or DNS issue. If you're pointing at staging or local dev, double-check `WIPPY_API_URL`:

```json
"env": {
  "WIPPY_API_TOKEN": "wpy_pat_...",
  "WIPPY_API_URL": "https://staging.wippy.app"
}
```

### "Wippy rate limit exceeded"

You're at 1000 calls per token per 24 hours. The error message includes the retry-after time. Budgets are per-token — mint a second token under a different name if you need more headroom for separate use cases.

### Tools don't appear in Claude Desktop after install

1. Confirm the config JSON parses (no trailing commas, proper quoting).
2. Quit Claude Desktop fully (Cmd-Q / right-click → Quit, not just close the window) and reopen.
3. Check Claude Desktop's MCP log (Settings → Developer → Open MCP Logs) for spawn errors.

## Backend compatibility

`0.1.x` requires the Wippy backend deployed **2026-05-24 or later** (when `/api/mcp/*` shipped — see [WIP-651](https://wippy.app)).

If a new tool ships server-side, this package bumps its **minor** version. If a tool's argument shape changes incompatibly, the package bumps its **major** version. Patch releases are server-compatible.

## Development

```bash
npm install
npm run build        # tsc → dist/
npm test             # vitest run
npm run typecheck    # tsc --noEmit
```

The package depends on `@modelcontextprotocol/sdk` v1 (stable). When the SDK reaches v2 stable, the migration plan lives in `docs/migration.md` of that repo — `server.tool()` → `server.registerTool()`, and the schema shape changes from raw-shape to `z.object(...)`.

## Releasing

This package is published manually by Sam:

```bash
npm version patch    # or minor / major
npm run build && npm test
npm publish --access public
git push --tags
```

The `prepublishOnly` script enforces a build + test gate before publication.

## License

MIT — see [LICENSE](./LICENSE).
