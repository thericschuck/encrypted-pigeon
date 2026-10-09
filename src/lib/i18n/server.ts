import { cookies, headers } from "next/headers";
import { cache } from "react";
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  isLocale,
  localeFromAcceptLanguage,
  type Locale,
} from "./config";
import { MESSAGES } from "./messages";
import { createT, type TFunction } from "./translate";

/**
 * The language of the current request: the cookie (set from the profile),
 * else the browser's Accept-Language (first visit / login page), else German.
 */
export const getLocale = cache(async (): Promise<Locale> => {
  const fromCookie = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (isLocale(fromCookie)) return fromCookie;
  return localeFromAcceptLanguage((await headers()).get("accept-language")) ?? DEFAULT_LOCALE;
});

/** Server Components, server actions, route handlers. */
export async function getT(): Promise<TFunction> {
  const locale = await getLocale();
  return createT(locale, MESSAGES[locale]);
}

/** Translator for a specific language (e.g. an email recipient's, not the request's). */
export function getTFor(locale: Locale): TFunction {
  return createT(locale, MESSAGES[locale]);
}
