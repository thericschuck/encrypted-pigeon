"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdminEmail } from "@/lib/auth/admin-email";
import type { MagicLinkState } from "@/lib/auth/magic-link-state";
import { NETWORK_ERROR_MESSAGE, isNetworkError } from "@/lib/supabase/resilient-fetch";

function errorMessage(error: { message: string }): string {
  return isNetworkError(error) ? NETWORK_ERROR_MESSAGE : error.message;
}

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

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!email) {
    return { status: "error", message: "Bitte eine E-Mail-Adresse eingeben." };
  }

  const admin = createAdminClient();
  const redirectTo = `${process.env.NEXT_PUBLIC_SITE_URL}/auth/callback`;

  // The invite list is what makes someone a member (lib/auth/bootstrap.ts);
  // record it before sending, so the link works the moment it arrives.
  const { error: inviteError } = await admin
    .from("invites")
    .upsert({ email, invited_by: user!.id }, { onConflict: "email", ignoreDuplicates: true });
  if (inviteError) {
    return { status: "error", message: errorMessage(inviteError) };
  }

  const { error } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo,
  });

  if (!error) {
    revalidatePath("/");
    return { status: "sent", message: `Einladung an ${email} verschickt.` };
  }

  if (!error.message.toLowerCase().includes("already been registered")) {
    return { status: "error", message: errorMessage(error) };
  }

  // Already has an account (e.g. an earlier invite they never opened) — fall
  // back to a fresh sign-in link instead of a dead end. Still via the admin
  // client, so this also completes via the implicit flow.
  const { error: resendError } = await admin.auth.resetPasswordForEmail(email, {
    redirectTo,
  });

  if (resendError) {
    return { status: "error", message: errorMessage(resendError) };
  }

  revalidatePath("/");
  return {
    status: "sent",
    message: `${email} hat schon einen Account — neuen Anmeldelink verschickt.`,
  };
}
