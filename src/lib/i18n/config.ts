/**
 * Supported UI languages. The user's choice lives in pigeon.profiles.language
 * (so it follows them across devices, and so push notifications / emails can
 * be sent in it) and is mirrored into a cookie that the server reads on every
 * request — same pattern as the theme (lib/theme.ts).
 */
export const LOCALES = ["de", "en", "fr", "zh"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "de";
export const LOCALE_COOKIE = "pigeon-lang";
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

/** Each language in its own language, so it is findable whatever the UI language is. */
export const LOCALE_NAMES: Record<Locale, string> = {
  de: "Deutsch",
  en: "English",
  fr: "Français",
  zh: "中文",
};

/** BCP-47 tag for Intl / toLocaleString. */
export const INTL_LOCALES: Record<Locale, string> = {
  de: "de-DE",
  en: "en-GB",
  fr: "fr-FR",
  zh: "zh-CN",
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

export function parseLocale(value: string | undefined | null): Locale {
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

export function intlLocale(locale: Locale): string {
  return INTL_LOCALES[locale];
}

/** First supported language in an Accept-Language header, or null. */
export function localeFromAcceptLanguage(header: string | null | undefined): Locale | null {
  if (!header) return null;
  for (const part of header.split(",")) {
    const tag = part.split(";")[0].trim().toLowerCase().slice(0, 2);
    if (isLocale(tag)) return tag;
  }
  return null;
}

/** Client-only: remember the language in the cookie the server reads. */
export function writeLocaleCookieInBrowser(locale: Locale) {
  document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=${ONE_YEAR_SECONDS}; samesite=lax`;
}

export function readLocaleCookieInBrowser(): Locale | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${LOCALE_COOKIE}=([^;]*)`));
  const value = match?.[1];
  return isLocale(value) ? value : null;
}
