"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdminEmail } from "@/lib/auth/admin-email";
import type { MagicLinkState } from "@/lib/auth/magic-link-state";

/**
 * Uses the service-role admin client (plain @supabase/supabase-js, not
 * @supabase/ssr) to invite, deliberately NOT the request-scoped client from
 * lib/supabase/server.ts.
 *
 * @supabase/ssr's createServerClient hard-codes flowType: "pkce", which
 * stores a code verifier as a cookie in whoever's browser *sends* the
 * request — fine for a self-service login, but broken for an invite: the
 * person who clicks the link is a different browser/device than the admin
 * who sent it, so that cookie is never there and the code exchange always
 * fails with pkce_code_verifier_not_found.
 *
 * The admin client has no such flowType override, so GoTrue completes these
 * admin-generated links via the implicit flow (tokens in the URL fragment)
 * instead — no cookie continuity required. auth/callback's client component
 * handles both flows.
 */
export async function inviteUser(
  _prevState: MagicLinkState,
  formData: FormData
): Promise<MagicLinkState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Re-check server-side — never trust that only the admin can reach this
  // action just because the page redirected non-admins away.
  if (!isAdminEmail(user?.email)) {
    return { status: "error", message: "Nicht berechtigt." };
  }

  const email = String(formData.get("email") ?? "").trim();
  if (!email) {
    return { status: "error", message: "Bitte eine E-Mail-Adresse eingeben." };
  }

  const admin = createAdminClient();
  const redirectTo = `${process.env.NEXT_PUBLIC_SITE_URL}/auth/callback`;

  const { error } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo,
  });

  if (!error) {
    return { status: "sent", message: `Einladung an ${email} verschickt.` };
  }

  if (!error.message.toLowerCase().includes("already been registered")) {
    return { status: "error", message: error.message };
  }

  // Already has an account (e.g. an earlier invite they never opened) — fall
  // back to a fresh sign-in link instead of a dead end. Still via the admin
  // client, so this also completes via the implicit flow.
  const { error: resendError } = await admin.auth.resetPasswordForEmail(email, {
    redirectTo,
  });

  if (resendError) {
    return { status: "error", message: resendError.message };
  }

  return {
    status: "sent",
    message: `${email} hat schon einen Account — neuen Anmeldelink verschickt.`,
  };
}
