import type { createAdminClient } from "@/lib/supabase/admin";
import type { Locale } from "@/lib/i18n/config";

type AdminClient = ReturnType<typeof createAdminClient>;

const LIST_PAGE_SIZE = 200;
const LIST_MAX_PAGES = 10;

async function findAuthUserId(
  admin: AdminClient,
  email: string,
  { paginate }: { paginate: boolean }
): Promise<string | null> {
  // Members have a pigeon.profiles row (same id as auth.users) — cheap lookup.
  const { data: profile } = await admin
    .from("profiles")
    .select("id")
    .ilike("email", email)
    .maybeSingle();
  if (profile) return profile.id;
  if (!paginate) return null;

  for (let page = 1; page <= LIST_MAX_PAGES; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: LIST_PAGE_SIZE });
    if (error) return null;
    const match = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (match) return match.id;
    if (data.users.length < LIST_PAGE_SIZE) return null;
  }
  return null;
}

/**
 * Sets user_metadata.language of an EXISTING auth user, so the email
 * templates (supabase/templates/*.html, `{{ .Data.language }}`) render in
 * that language — GoTrue ignores `data` passed to signInWithOtp / recovery
 * for existing users. Best effort: never throws, so a failure here can't
 * block sending the mail.
 */
export async function setAuthUserLanguage(
  admin: AdminClient,
  email: string,
  language: Locale,
  options: { paginate?: boolean } = {}
): Promise<void> {
  try {
    const id = await findAuthUserId(admin, email.trim(), { paginate: options.paginate ?? false });
    if (!id) return;
    await admin.auth.admin.updateUserById(id, { user_metadata: { language } });
  } catch (error) {
    console.error("Could not set email language:", error);
  }
}
