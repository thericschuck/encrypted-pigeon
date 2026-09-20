import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

/**
 * Service-role Supabase client for privileged, server-only bootstrap steps
 * (creating a profile/chat on first login) that must not depend on the
 * caller's own RLS grants — e.g. a brand-new friend has no row anywhere yet
 * to base a policy on.
 *
 * NEVER import this from a Client Component or anything bundled for the
 * browser: SUPABASE_SERVICE_ROLE_KEY bypasses Row Level Security entirely.
 */
export function createAdminClient() {
  return createSupabaseClient<Database, "pigeon">(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      db: { schema: "pigeon" },
      auth: { autoRefreshToken: false, persistSession: false },
    }
  );
}
