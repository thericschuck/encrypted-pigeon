"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdminEmail } from "@/lib/auth/admin-email";
import { authCallbackUrl } from "@/lib/site-url";
import type { MagicLinkState } from "@/lib/auth/magic-link-state";
import { isNetworkError } from "@/lib/supabase/resilient-fetch";
import { setAuthUserLanguage } from "@/lib/auth/user-language";
import { isLocale } from "@/lib/i18n/config";
import { getLocale, getT } from "@/lib/i18n/server";

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
  const t = await getT();
  const errorMessage = (error: { message: string }): string =>
    isNetworkError(error) ? t("common.networkError") : error.message;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Re-check server-side — never trust that only the admin can reach this
  // action just because the page redirected non-admins away.
  if (!isAdminEmail(user?.email)) {
    return { status: "error", message: t("auth.invite.notAllowed") };
  }

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!email) {
    return { status: "error", message: t("auth.emailRequired") };
  }

  // Language of the email (and the invitee's initial app language).
  const languageField = formData.get("language");
  const language = isLocale(languageField) ? languageField : await getLocale();

  const admin = createAdminClient();
  const redirectTo = await authCallbackUrl();

  // The invite list is what makes someone a member (lib/auth/bootstrap.ts);
  // record it before sending, so the link works the moment it arrives.
  const { error: inviteError } = await admin
    .from("invites")
    .upsert({ email, invited_by: user!.id, language }, { onConflict: "email" });
  if (inviteError) {
    return { status: "error", message: errorMessage(inviteError) };
  }

  // `data` lands in user_metadata.language, which the invite template reads.
  const { error } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo,
    data: { language },
  });

  if (!error) {
    revalidatePath("/");
    return { status: "sent", message: t("auth.invite.sent", { email }) };
  }

  if (!error.message.toLowerCase().includes("already been registered")) {
    return { status: "error", message: errorMessage(error) };
  }

  // Already has an account (e.g. an earlier invite they never opened) — fall
  // back to a fresh sign-in link instead of a dead end. Still via the admin
  // client, so this also completes via the implicit flow. GoTrue ignores
  // `data` for existing users, so set the language on the account first —
  // the recovery template reads user_metadata.language.
  await setAuthUserLanguage(admin, email, language, { paginate: true });
  const { error: resendError } = await admin.auth.resetPasswordForEmail(email, {
    redirectTo,
  });

  if (resendError) {
    return { status: "error", message: errorMessage(resendError) };
  }

  revalidatePath("/");
  return {
    status: "sent",
    message: t("auth.invite.alreadyRegistered", { email }),
  };
}
