"use client";

import { useEffect } from "react";
import type { ThemePreference } from "@/lib/supabase/types";
import { applyThemeInBrowser, readThemeCookieInBrowser } from "@/lib/theme";

/**
 * Brings the theme cookie in line with the profile's saved theme — e.g. on
 * a new device, or after changing it on another one. Mounted on pages that
 * already load the user's profile anyway (dashboard, chat, settings).
 */
export function ThemeSync({ theme }: { theme: ThemePreference }) {
  useEffect(() => {
    if (readThemeCookieInBrowser() !== theme) applyThemeInBrowser(theme);
  }, [theme]);

  return null;
}
