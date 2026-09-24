"use client";

import { useEffect } from "react";
import type { ThemePreference } from "@/lib/supabase/types";
import { applyThemeInBrowser, readThemeCookieInBrowser } from "@/lib/theme";
import { applyAccentInBrowser, readAccentCookieInBrowser } from "@/lib/accent";
import { DEFAULT_ACCENT } from "@/lib/profile";

/**
 * Brings the theme and accent cookies in line with the profile's saved
 * values — e.g. on a new device, or after changing them on another one.
 * Mounted on pages that already load the user's profile anyway
 * (dashboard, chat, settings).
 */
export function ThemeSync({ theme, accent }: { theme: ThemePreference; accent?: string | null }) {
  useEffect(() => {
    if (readThemeCookieInBrowser() !== theme) applyThemeInBrowser(theme);
  }, [theme]);

  useEffect(() => {
    if (accent === undefined) return;
    const wanted = accent && accent !== DEFAULT_ACCENT ? accent : null;
    if (readAccentCookieInBrowser() !== wanted) applyAccentInBrowser(wanted);
  }, [accent]);

  return null;
}
