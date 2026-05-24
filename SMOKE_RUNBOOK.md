# Smoke runbook — verify before `npm publish`

Run this BEFORE publishing v0.1.0 to npm. Catches the failure modes that unit tests can't reach: SDK transport handshake, Claude Desktop spawn lifecycle, real-network auth, end-to-end tool dispatch.

## Prerequisites

- Wippy account with at least one client + return in the DB (sam@richisontax.com works against `wippy.app` prod)
- Claude Desktop installed
- One Wippy PAT generated at <https://wippy.app/account/api-tokens> (name it `smoke-test-vN` so it's identifiable in the audit log)

## Step 1 — Local build + test

```bash
cd /c/Users/frame/Claude/wippyapp-mcp
npm install
npm run build
npm test
```

Expected: `npm test` reports all green (~15 tests across `client.test.ts` + `tools.test.ts`). If anything red, do NOT proceed.

## Step 2 — Local stdio smoke (no Claude needed)

```bash
WIPPY_API_TOKEN="wpy_pat_..." node dist/index.js
```

Expected: stderr prints `@wippyapp/mcp running on stdio (target: https://wippy.app)`. Process stays alive waiting for stdin. Press `Ctrl+C` to kill. If it exits immediately with the SETUP_HINT, the env var didn't propagate — re-check the shell.

## Step 3 — `npm pack` dry-run

```bash
npm pack --dry-run
```

Inspect the output for the files-to-be-published. Should include:
- `dist/index.js`, `dist/index.d.ts`, `dist/index.js.map`
- `dist/{client,server,tools,errors}.js` + `.d.ts` + `.map`
- `package.json`, `README.md`, `LICENSE`

Should NOT include:
- `src/`, `node_modules/`, `*.test.*`, `tsconfig.json`, `.gitignore`

If `src/` or test files leak through, the `files` allowlist in `package.json` is mis-configured.

## Step 4 — Install locally and wire to Claude Desktop

In a separate scratch dir:

```bash
mkdir /tmp/wippy-mcp-smoke && cd /tmp/wippy-mcp-smoke
npm install /c/Users/frame/Claude/wippyapp-mcp   # install from local checkout
npx @wippyapp/mcp                                  # should print setup hint + exit (no token)
```

Then edit Claude Desktop config:

```json
{
  "mcpServers": {
    "wippy-smoke": {
      "command": "node",
      "args": ["/tmp/wippy-mcp-smoke/node_modules/@wippyapp/mcp/dist/index.js"],
      "env": {
        "WIPPY_API_TOKEN": "wpy_pat_..."
      }
    }
  }
}
```

Restart Claude Desktop fully (Cmd-Q / right-click Quit). Open a new chat.

## Step 5 — Tool-by-tool verification in Claude Desktop

Send these prompts one at a time. Expected: Claude invokes the named tool and returns structured data.

| Prompt | Expected tool | Verify |
|---|---|---|
| "List up to 5 of my clients matching 'Smith' using Wippy." | `lookup_client` | Returns `found: true` + an array of clients with `id`, `name`, `type`, `returns[]` |
| "What's the status of the first Smith client's most recent return?" | `get_return_status` | Returns `found: true` + `returns[]` with `taxYear`, `status`, `filingDeadline` |
| "What Wippy deadlines are coming up in the next 30 days?" | `get_upcoming_deadlines` | Returns `count`, `lookAheadDays: 30`, `deadlines[]` sorted by `filingDeadline` |
| "Search my Wippy practice for the word 'Acme'." | `search_practice` | Returns `clients[]`, `entities[]`, `returns[]`, `totalResults` |
| "Show me my Wippy dashboard stats." | `get_dashboard_stats` | Returns `totalActiveClients`, `activeReturns`, `returnsByStatus`, `totalBilled` |

## Step 6 — Error-path checks

| Test | How | Expected error message |
|---|---|---|
| **Bad token** | Set `WIPPY_API_TOKEN=wpy_pat_99_garbage`, restart Claude, retry any prompt | "Wippy API token was rejected. Set WIPPY_API_TOKEN... https://wippy.app/account/api-tokens" |
| **Revoked token** | In Wippy UI, revoke the smoke-test PAT. Restart Claude, retry. | Same as bad token (401) |
| **Network down** | Set `WIPPY_API_URL=http://localhost:9999` (nothing listening). Restart Claude, retry. | "Cannot reach Wippy API: ... Check WIPPY_API_URL and network connectivity." |
| **Rate limit** | Cannot easily smoke-test without burning real budget. Trust the unit test in `client.test.ts`. | — |

## Step 7 — Audit log verification

After the tool-by-tool checks, ssh to the wippy droplet and verify the audit rows landed:

```bash
ssh wippy
docker exec wip-tracker-backend-1 node -e "
  const { PrismaClient } = require('@prisma/client');
  const p = new PrismaClient();
  (async () => {
    const rows = await p.auditLog.findMany({
      where: { action: 'mcp_tool_call' },
      orderBy: { id: 'desc' },
      take: 10,
    });
    for (const r of rows) {
      const meta = JSON.parse(r.metadata);
      console.log(\`#\${r.id} \${meta.tool} firmId=\${r.firmId} userId=\${r.userId} entityId=\${r.entityId} \${meta.durationMs}ms\`);
    }
  })();
"
```

Expected: 5+ rows (one per smoke step), each with `entityId` matching the smoke-test PAT id, `paramKeys` array, `resultSummary` counts. Should NOT contain raw client names / search queries / SSNs in any metadata field.

## Step 8 — Clean up

```bash
# Revoke the smoke-test PAT at https://wippy.app/account/api-tokens
# Remove the "wippy-smoke" entry from claude_desktop_config.json
# Remove /tmp/wippy-mcp-smoke
```

## Step 9 — Ready to publish

If all 8 steps pass, the package is ready for `npm publish`. Run from the repo root:

```bash
cd /c/Users/frame/Claude/wippyapp-mcp
npm whoami   # confirm logged in to the right npm account
npm publish --access public
```

Verify the publish:

```bash
npm view @wippyapp/mcp
```

Tag the release in git:

```bash
git tag v0.1.0
git push origin v0.1.0
```

Update the Wippy `/account/api-tokens` page (frontend) to show the install snippet (separate ticket).
