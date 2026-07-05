/**
 * Thin HTTP client over the running DevDigest API (default :3001).
 *
 * The MCP server holds zero domain logic — it resolves ids, calls the existing
 * REST routes, and shapes concise results. Non-2xx responses and connection
 * failures are turned into FORWARD-LEADING errors (they tell the caller what to
 * do next), per the "errors lead forward" tool-design principle.
 */

const DEFAULT_BASE = 'http://localhost:3001';

/** An API-level failure with a caller-actionable message. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export class DevDigestClient {
  readonly baseUrl: string;

  constructor(baseUrl: string = process.env.DEVDIGEST_API_URL ?? DEFAULT_BASE) {
    // Trim a trailing slash so `${baseUrl}${path}` is always well-formed.
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }

  post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('POST', path, body);
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      // Connection refused / DNS / offline — the API almost certainly isn't up.
      throw new ApiError(
        `DevDigest API not reachable at ${this.baseUrl} — start it first with ./scripts/dev.sh (it listens on :3001).`,
      );
    }

    if (!res.ok) {
      const hint =
        res.status === 422 ? ' — check the id is a valid resource UUID (e.g. from list_agents).' : '';
      throw new ApiError(
        `${method} ${path} failed (HTTP ${res.status}): ${await readErrorMessage(res)}${hint}`,
        res.status,
      );
    }

    return (await res.json()) as T;
  }
}

/** Extract the API's structured error envelope `{ error: { message } }` if present. */
async function readErrorMessage(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { error?: { message?: string; code?: string } };
    return data.error?.message ?? res.statusText;
  } catch {
    return res.statusText;
  }
}
