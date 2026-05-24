/**
 * WippyClient unit tests — mock fetch, verify request shape + error
 * mapping. The error-mapping suite is the load-bearing one: every
 * production failure mode the consumer will see is covered here.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { WippyClient } from '../client.js';

const okResponse = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

const errResponse = (
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

describe('WippyClient — request shape', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('POSTs to the configured apiUrl + /api/mcp/<route>', async () => {
    fetchMock.mockResolvedValueOnce(okResponse({ found: true, clients: [] }));
    const client = new WippyClient({
      apiToken: 'wpy_pat_1_secret',
      apiUrl: 'https://staging.wippy.app',
    });
    await client.callTool('lookup-client', { name: 'Acme' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://staging.wippy.app/api/mcp/lookup-client');
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer wpy_pat_1_secret');
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['User-Agent']).toBe('@wippyapp/mcp');
    expect(init.body).toBe(JSON.stringify({ name: 'Acme' }));
  });

  it('defaults to https://wippy.app when apiUrl is not provided', async () => {
    fetchMock.mockResolvedValueOnce(okResponse({}));
    const client = new WippyClient({ apiToken: 'wpy_pat_1_secret' });
    await client.callTool('dashboard-stats', {});

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://wippy.app/api/mcp/dashboard-stats');
  });

  it('strips trailing slash from apiUrl (no double-slash in URL)', async () => {
    fetchMock.mockResolvedValueOnce(okResponse({}));
    const client = new WippyClient({ apiToken: 'x', apiUrl: 'https://wippy.app/' });
    await client.callTool('dashboard-stats', {});

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://wippy.app/api/mcp/dashboard-stats');
  });

  it('returns the parsed JSON response on 200', async () => {
    const payload = { found: true, clients: [{ id: 1, name: 'Acme' }] };
    fetchMock.mockResolvedValueOnce(okResponse(payload));
    const client = new WippyClient({ apiToken: 'x' });
    const result = await client.callTool('lookup-client', { name: 'Acme' });
    expect(result).toEqual(payload);
  });
});

describe('WippyClient — error mapping', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('maps 401 → InvalidRequest with token regen hint', async () => {
    fetchMock.mockResolvedValueOnce(errResponse(401, { error: 'Invalid token' }));
    const client = new WippyClient({ apiToken: 'bad' });
    await expect(client.callTool('lookup-client', { name: 'X' })).rejects.toMatchObject({
      code: ErrorCode.InvalidRequest,
      message: expect.stringContaining('token was rejected'),
    });
  });

  it('401 message links the token-generation page (single most common setup error)', async () => {
    fetchMock.mockResolvedValueOnce(errResponse(401, {}));
    const client = new WippyClient({ apiToken: 'bad' });
    try {
      await client.callTool('lookup-client', { name: 'X' });
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(McpError);
      expect((err as Error).message).toContain('wippy.app/account/api-tokens');
    }
  });

  it('maps 403 → InvalidRequest with required-scope name', async () => {
    fetchMock.mockResolvedValueOnce(
      errResponse(403, { error: 'Insufficient scope', required: 'mcp:read' }),
    );
    const client = new WippyClient({ apiToken: 'noscope' });
    await expect(client.callTool('lookup-client', { name: 'X' })).rejects.toMatchObject({
      code: ErrorCode.InvalidRequest,
      message: expect.stringContaining('mcp:read'),
    });
  });

  it('maps 429 → InternalError with Retry-After header value', async () => {
    fetchMock.mockResolvedValueOnce(
      errResponse(
        429,
        { error: 'Rate limit exceeded', limit: 1000, windowSec: 86400, retryAfterSec: 42 },
        { 'retry-after': '42' },
      ),
    );
    const client = new WippyClient({ apiToken: 'x' });
    await expect(client.callTool('lookup-client', { name: 'X' })).rejects.toMatchObject({
      code: ErrorCode.InternalError,
      message: expect.stringContaining('Retry after 42s'),
    });
  });

  it('maps 400 (Zod validation) → InvalidParams with details payload preserved', async () => {
    const details = { fieldErrors: { name: ['Required'] } };
    fetchMock.mockResolvedValueOnce(errResponse(400, { error: 'Invalid request', details }));
    const client = new WippyClient({ apiToken: 'x' });
    try {
      await client.callTool('lookup-client', {});
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(McpError);
      expect((err as McpError).code).toBe(ErrorCode.InvalidParams);
      expect((err as McpError).data).toEqual(details);
    }
  });

  it('maps 500 → InternalError with backend error message', async () => {
    fetchMock.mockResolvedValueOnce(errResponse(500, { error: 'Tool execution failed' }));
    const client = new WippyClient({ apiToken: 'x' });
    await expect(client.callTool('lookup-client', { name: 'X' })).rejects.toMatchObject({
      code: ErrorCode.InternalError,
      message: expect.stringContaining('Tool execution failed'),
    });
  });

  it('maps fetch network failure → InternalError with WIPPY_API_URL hint', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const client = new WippyClient({ apiToken: 'x', apiUrl: 'http://localhost:9999' });
    await expect(client.callTool('lookup-client', { name: 'X' })).rejects.toMatchObject({
      code: ErrorCode.InternalError,
      message: expect.stringContaining('Cannot reach Wippy API'),
    });
  });

  it('tolerates non-JSON error body (e.g., proxy HTML page) without throwing TypeError', async () => {
    fetchMock.mockResolvedValueOnce(new Response('<html>502 Bad Gateway</html>', { status: 502 }));
    const client = new WippyClient({ apiToken: 'x' });
    await expect(client.callTool('lookup-client', { name: 'X' })).rejects.toMatchObject({
      code: ErrorCode.InternalError,
    });
  });

  it('falls back gracefully when 429 omits Retry-After header (body-only retryAfterSec)', async () => {
    fetchMock.mockResolvedValueOnce(
      errResponse(429, { error: 'Rate limit exceeded', limit: 1000, retryAfterSec: 17 }),
    );
    const client = new WippyClient({ apiToken: 'x' });
    await expect(client.callTool('lookup-client', { name: 'X' })).rejects.toMatchObject({
      code: ErrorCode.InternalError,
      message: expect.stringContaining('Retry after 17s'),
    });
  });
});
