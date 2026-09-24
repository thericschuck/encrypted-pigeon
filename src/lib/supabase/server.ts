import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@/lib/supabase/types";
import { resilientFetch } from "@/lib/supabase/resilient-fetch";

/**
 * Supabase client for use in Server Components, Server Actions, and Route
 * Handlers. Must be created per-request (it closes over `cookies()`).
 *
 * Server Components can't write cookies, so `set`/`remove` there are
 * no-ops guarded by try/catch; a middleware refreshing the session is what
 * actually persists the new tokens in that case.
 *
 * Defaults to the "pigeon" schema (not "public") — see client.ts for why.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database, "pigeon">(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      db: { schema: "pigeon" },
      global: { fetch: resilientFetch },
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Called from a Server Component — ignore, middleware handles it.
          }
        },
      },
    }
  );
}
