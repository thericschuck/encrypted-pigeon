"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { Locale } from "./config";
import { createT, type TFunction } from "./translate";

interface I18nValue {
  locale: Locale;
  t: TFunction;
}

const I18nContext = createContext<I18nValue | null>(null);

/**
 * Mounted once in the root layout with only the current language's messages
 * (the other three never reach the browser). Changing the language refreshes
 * the layout, which hands a new dictionary down.
 */
export function I18nProvider({
  locale,
  messages,
  children,
}: {
  locale: Locale;
  messages: Record<string, string>;
  children: ReactNode;
}) {
  const value = useMemo(() => ({ locale, t: createT(locale, messages) }), [locale, messages]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error("useT/useLocale must be used inside <I18nProvider>");
  return value;
}

/** Client components: const t = useT(); t("chatRoom.send") */
export function useT(): TFunction {
  return useI18n().t;
}

export function useLocale(): Locale {
  return useI18n().locale;
}
