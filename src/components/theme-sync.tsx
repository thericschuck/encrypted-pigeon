"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import type { ThemePreference } from "@/lib/supabase/types";
import { applyThemeInBrowser, readThemeCookieInBrowser } from "@/lib/theme";
import { applyAccentInBrowser, readAccentCookieInBrowser } from "@/lib/accent";
import { readLocaleCookieInBrowser, writeLocaleCookieInBrowser, type Locale } from "@/lib/i18n/config";
import { DEFAULT_ACCENT } from "@/lib/profile";

/**
 * Brings the theme, accent and language cookies in line with the profile's
 * saved values — e.g. on a new device, or after changing them on another one.
 * Mounted on pages that already load the user's profile anyway
 * (dashboard, chat, settings).
 */
export function ThemeSync({
  theme,
  accent,
  language,
}: {
  theme: ThemePreference;
  accent?: string | null;
  language?: Locale;
}) {
  const router = useRouter();

  useEffect(() => {
    if (readThemeCookieInBrowser() !== theme) applyThemeInBrowser(theme);
  }, [theme]);

  useEffect(() => {
    if (accent === undefined) return;
    const wanted = accent && accent !== DEFAULT_ACCENT ? accent : null;
    if (readAccentCookieInBrowser() !== wanted) applyAccentInBrowser(wanted);
  }, [accent]);

  useEffect(() => {
    if (!language || readLocaleCookieInBrowser() === language) return;
    // The server renders from this cookie, so re-render once it is correct.
    writeLocaleCookieInBrowser(language);
    router.refresh();
  }, [language, router]);

  return null;
}
