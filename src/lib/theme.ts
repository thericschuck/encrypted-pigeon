import type { ThemePreference } from "@/lib/supabase/types";

// The user's theme lives in pigeon.profiles.theme (so it follows them
// across devices) and is mirrored into this cookie, which the root layout
// reads to put the right class on <html> in the very first HTML response —
// no flash of the wrong theme, and no extra DB query per navigation.
export const THEME_COOKIE = "pigeon-theme";
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

export function parseTheme(value: string | undefined | null): ThemePreference {
  return value === "light" || value === "dark" ? value : "system";
}

/** Class for <html>: "light"/"dark" force a scheme, "" follows the OS. */
export function themeClass(theme: ThemePreference): string {
  return theme === "system" ? "" : theme;
}

/** Client-only: apply immediately and remember in the cookie. */
export function applyThemeInBrowser(theme: ThemePreference) {
  const root = document.documentElement;
  root.classList.remove("light", "dark");
  if (theme !== "system") root.classList.add(theme);
  document.cookie = `${THEME_COOKIE}=${theme}; path=/; max-age=${ONE_YEAR_SECONDS}; samesite=lax`;
}

export function readThemeCookieInBrowser(): ThemePreference {
  const match = document.cookie.match(new RegExp(`(?:^|; )${THEME_COOKIE}=([^;]*)`));
  return parseTheme(match?.[1]);
}
