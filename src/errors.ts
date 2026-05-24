/**
 * Map Wippy backend HTTP responses to MCP protocol errors.
 *
 * The MCP SDK's ErrorCode set is JSON-RPC-2.0-derived (InvalidRequest,
 * InvalidParams, InternalError, etc.) — no rate-limit-specific code.
 * We map by category, not 1:1 by status. The message text is the load-
 * bearing piece because the Claude client surfaces it to the user.
 *
 * 401 is the single most common first-time-setup failure (bad/missing
 * token, copy-paste mistake, revoked-but-still-in-config). Its message
 * MUST be immediately actionable: name the env var, link the regen URL.
 */
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';

export interface BackendErrorBody {
  error?: string;
  required?: string; // 403 carries the missing scope name
  limit?: number;
  windowSec?: number;
  retryAfterSec?: number;
  details?: unknown; // 400 carries Zod flatten() details
}

const TOKEN_HELP =
  'Set WIPPY_API_TOKEN to a valid token. Generate one at https://wippy.app/account/api-tokens.';

export function mapBackendError(
  status: number,
  body: BackendErrorBody | null,
  retryAfterHeader: string | null,
): McpError {
  switch (status) {
    case 401:
      return new McpError(
        ErrorCode.InvalidRequest,
        `Wippy API token was rejected. ${TOKEN_HELP}`,
      );
    case 403:
      return new McpError(
        ErrorCode.InvalidRequest,
        `Token lacks required scope: ${body?.required ?? 'mcp:read'}. ${TOKEN_HELP}`,
      );
    case 429: {
      // Prefer the Retry-After header (server-authoritative); fall back
      // to the body's retryAfterSec; final fallback to literal "?".
      const retry = retryAfterHeader ?? body?.retryAfterSec ?? '?';
      const limit = body?.limit ?? 1000;
      const windowSec = body?.windowSec ?? 24 * 60 * 60;
      return new McpError(
        ErrorCode.InternalError,
        `Wippy rate limit exceeded (${limit} calls / ${windowSec}s per token). Retry after ${retry}s.`,
      );
    }
    case 400:
      return new McpError(
        ErrorCode.InvalidParams,
        body?.error ?? 'Invalid request to Wippy',
        body?.details,
      );
    default:
      return new McpError(
        ErrorCode.InternalError,
        `Wippy API returned ${status}: ${body?.error ?? 'unknown error'}`,
      );
  }
}

export function networkError(err: Error): McpError {
  return new McpError(
    ErrorCode.InternalError,
    `Cannot reach Wippy API: ${err.message}. Check WIPPY_API_URL and network connectivity.`,
  );
}
