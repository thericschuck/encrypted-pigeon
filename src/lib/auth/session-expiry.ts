// Client-side helpers for "your session is gone" handling: instead of a
// request silently failing (or a component crashing on an RLS-empty
// result), send the user back to /login with a friendly explanation.

export const SESSION_EXPIRED_LOGIN_PATH = "/login?error=session_expired";

interface MaybeAuthError {
  status?: number;
  code?: string;
  message?: string;
}

/**
 * True for errors that mean "not (or no longer) authenticated", as opposed
 * to a network problem or a genuine permission denial. Covers PostgREST
 * (PGRST301/PGRST303, HTTP 401), GoTrue refresh failures and Storage's
 * JWT errors, which all phrase it slightly differently.
 */
export function isSessionExpiredError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const { status, code, message } = error as MaybeAuthError;
  if (status === 401) return true;
  if (code === "PGRST301" || code === "PGRST303") return true;
  if (code === "refresh_token_not_found" || code === "session_not_found") return true;
  return /jwt expired|invalid jwt|refresh token|not authenticated/i.test(message ?? "");
}

let redirecting = false;

/**
 * Full page navigation (not router.push) on purpose: it drops all client
 * state, realtime channels and pending timers in one go, and the middleware
 * then decides where the user lands.
 */
export function redirectToLoginForExpiredSession() {
  if (typeof window === "undefined" || redirecting) return;
  redirecting = true;
  window.location.assign(SESSION_EXPIRED_LOGIN_PATH);
}
