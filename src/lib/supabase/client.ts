import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/lib/supabase/types";

/**
 * Supabase client for use in Client Components ("use client").
 * Reads the session from browser cookies set by the server client.
 *
 * Defaults to the "pigeon" schema (not "public") — this Supabase project is
 * shared with an unrelated prior project, so all app tables/queries are
 * scoped there. Requires "pigeon" to be added under Project Settings -> API
 * -> Data API -> Exposed schemas, or every request 404s.
 */
export function createClient() {
  return createBrowserClient<Database, "pigeon">(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { db: { schema: "pigeon" } }
  );
}
