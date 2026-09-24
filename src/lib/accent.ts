// The user's accent color colors every primary button, switch and own
// chat bubble, via the --accent / --accent-fg / --bubble CSS variables
// (tailwind: bg-accent, text-on-accent, bg-bubble; defaults per scheme in
// globals.css). Like the theme (lib/theme.ts), it lives in
// pigeon.profiles.accent_color and is mirrored into a cookie so the root
// layout can put it on <html> in the first HTML response — no flash of the
// default color on load.
export const ACCENT_COOKIE = "pigeon-accent";
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

export function parseAccent(value: string | undefined | null): string | null {
  const decoded = value ? decodeURIComponent(value) : "";
  return /^#[0-9a-f]{6}$/.test(decoded) ? decoded : null;
}

/** Inline style for <html>; null (default accent) leaves the CSS defaults in charge. */
export function accentStyle(accent: string | null): Record<string, string> | undefined {
  if (!accent) return undefined;
  // Every preset keeps white text readable (see ACCENT_PRESETS).
  return { "--accent": accent, "--accent-fg": "#ffffff", "--bubble": accent };
}

/** Client-only: apply immediately and remember in the cookie. */
export function applyAccentInBrowser(accent: string | null) {
  const root = document.documentElement;
  for (const name of ["--accent", "--accent-fg", "--bubble"]) root.style.removeProperty(name);
  const style = accentStyle(accent);
  if (style) for (const [name, value] of Object.entries(style)) root.style.setProperty(name, value);
  document.cookie = accent
    ? `${ACCENT_COOKIE}=${encodeURIComponent(accent)}; path=/; max-age=${ONE_YEAR_SECONDS}; samesite=lax`
    : `${ACCENT_COOKIE}=; path=/; max-age=0; samesite=lax`;
}

export function readAccentCookieInBrowser(): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${ACCENT_COOKIE}=([^;]*)`));
  return parseAccent(match?.[1]);
}
