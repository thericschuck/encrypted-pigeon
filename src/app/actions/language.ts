"use server";

import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { LOCALE_COOKIE, isLocale } from "@/lib/i18n/config";

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

/**
 * Switches the UI language: the cookie takes effect on the very next render
 * (also on the login page, where nobody is signed in); for a signed-in member
 * it is saved on the profile too, so it follows them to other devices and
 * drives push notifications and emails.
 */
export async function setLanguage(language: string): Promise<{ ok: boolean }> {
  if (!isLocale(language)) return { ok: false };

  (await cookies()).set(LOCALE_COOKIE, language, {
    path: "/",
    maxAge: ONE_YEAR_SECONDS,
    sameSite: "lax",
  });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: true };

  const { error } = await supabase.from("profiles").update({ language }).eq("id", user.id);
  if (error) {
    console.error("Saving language failed:", error);
    return { ok: false };
  }
  return { ok: true };
}
