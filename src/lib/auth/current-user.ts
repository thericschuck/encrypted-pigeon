import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

export interface CurrentUser {
  id: string;
  email: string | null;
}

/**
 * One Supabase server client per request, shared by the layout and page
 * (React's cache() is scoped to a single server render).
 */
export const getServerSupabase = cache(createClient);

/**
 * The signed-in user for this server render, or null.
 *
 * Uses getClaims(), not getUser(): the project signs JWTs asymmetrically
 * (ES256), so the token is verified locally against the cached JWKS
 * instead of a round trip to the Auth server on every render — and cache()
 * makes layout + page share that one check. The middleware has already
 * refreshed the session by the time this runs.
 *
 * Trade-off: a session revoked elsewhere (sign-out on another device)
 * stays valid here until its access token expires (≤ 1h). Server actions
 * that change data keep using getUser() for that reason.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const supabase = await getServerSupabase();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub) return null;
  return { id: claims.sub, email: typeof claims.email === "string" ? claims.email : null };
});
