/**
 * Thin fetch wrapper around the Wippy MCP API surface
 * (https://wippy.app/api/mcp/* — see backend/src/routes/mcp.ts).
 *
 * Responsibilities:
 *  - Attach Bearer auth from WIPPY_API_TOKEN
 *  - POST + JSON-encode the body
 *  - 30-second request timeout (covers DNS hang + slow server)
 *  - Translate non-2xx responses to McpError via errors.ts
 *  - Translate fetch failures (DNS, ECONNREFUSED, abort) to McpError
 *
 * This module is deliberately stateless and protocol-free — the McpServer
 * binding lives in tools.ts.
 */
import { mapBackendError, networkError, type BackendErrorBody } from './errors.js';

const DEFAULT_API_URL = 'https://wippy.app';
const REQUEST_TIMEOUT_MS = 30_000;

export interface WippyClientConfig {
  /** Override the API base URL. Defaults to https://wippy.app. */
  apiUrl?: string;
  /** Personal access token (wpy_pat_<id>_<secret>). Required. */
  apiToken: string;
}

export class WippyClient {
  private readonly apiUrl: string;
  private readonly apiToken: string;

  constructor(config: WippyClientConfig) {
    // Strip trailing slash so URL concatenation is unambiguous.
    this.apiUrl = (config.apiUrl ?? DEFAULT_API_URL).replace(/\/+$/, '');
    this.apiToken = config.apiToken;
  }

  /**
   * POST to /api/mcp/<route> with the given JSON body.
   * Throws an McpError on any non-2xx response or network failure.
   */
  async callTool(route: string, body: Record<string, unknown>): Promise<unknown> {
    const url = `${this.apiUrl}/api/mcp/${route}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiToken}`,
          'Content-Type': 'application/json',
          // Identify the client in backend audit logs / server logs.
          'User-Agent': '@wippyapp/mcp',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timeout);
      throw networkError(err as Error);
    }
    clearTimeout(timeout);

    if (response.ok) {
      return await response.json();
    }

    // Try to parse a structured error body; tolerate non-JSON.
    let errorBody: BackendErrorBody | null = null;
    try {
      errorBody = (await response.json()) as BackendErrorBody;
    } catch {
      // Body wasn't JSON — mapBackendError handles null.
    }
    throw mapBackendError(response.status, errorBody, response.headers.get('retry-after'));
  }
}
