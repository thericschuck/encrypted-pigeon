/**
 * fetch for every Supabase client (browser, server, middleware, admin).
 *
 * The connection to Supabase (Cloudflare) can be slow and drop now and
 * then — e.g. from networks in China — which surfaced as a bare
 * "fetch failed" on login. This retries requests that failed at the
 * network level (no HTTP response at all); HTTP errors (4xx/5xx) are
 * real answers and are passed through untouched.
 *
 * Retrying must not send a write twice: GET/HEAD are retried on any
 * network error, everything else only when the connection itself could
 * not be established (the request never left this machine).
 */

const RETRY_DELAYS_MS = [400, 1200];

// undici / Node error codes for "never connected".
const CONNECT_ERROR_CODES = new Set([
  "UND_ERR_CONNECT_TIMEOUT",
  "ECONNREFUSED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ENETUNREACH",
  "EHOSTUNREACH",
]);

function errorCode(error: unknown): string | undefined {
  const cause = (error as { cause?: { code?: string } } | null)?.cause;
  return cause?.code ?? (error as { code?: string } | null)?.code;
}

function isRetryable(error: unknown, method: string, signal: AbortSignal | null | undefined) {
  if (signal?.aborted) return false;
  if ((error as { name?: string } | null)?.name === "AbortError") return false;
  if (method === "GET" || method === "HEAD") return true;
  const code = errorCode(error);
  return code !== undefined && CONNECT_ERROR_CODES.has(code);
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const resilientFetch: typeof fetch = async (input, init) => {
  const method = (
    init?.method ?? (input instanceof Request ? input.method : "GET")
  ).toUpperCase();
  const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);

  for (let attempt = 0; ; attempt += 1) {
    try {
      // A Request body can only be read once; clone it for every attempt.
      return await fetch(input instanceof Request ? input.clone() : input, init);
    } catch (error) {
      if (attempt >= RETRY_DELAYS_MS.length || !isRetryable(error, method, signal)) throw error;
      await wait(RETRY_DELAYS_MS[attempt]);
    }
  }
};

const NETWORK_ERROR_PATTERN = /fetch failed|failed to fetch|network|timed? ?out|ECONN|ENOTFOUND|EAI_AGAIN|UND_ERR/i;

/** True for "couldn't reach Supabase at all" (as opposed to a real answer like "wrong password"). */
export function isNetworkError(error: unknown): boolean {
  if (!error) return false;
  const e = error as { name?: string; message?: string; status?: number };
  if (e.name === "AuthRetryableFetchError") return true;
  return NETWORK_ERROR_PATTERN.test(e.message ?? String(error));
}

export const NETWORK_ERROR_MESSAGE =
  "Verbindung zum Server fehlgeschlagen. Bitte Internet/VPN prüfen und nochmal versuchen.";
