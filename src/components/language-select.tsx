"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { setLanguage } from "@/app/actions/language";
import { LOCALES, LOCALE_NAMES, isLocale, writeLocaleCookieInBrowser } from "@/lib/i18n/config";
import { useLocale, useT } from "@/lib/i18n/client";

/** Compact language switcher for pages without settings (the login page). */
export function LanguageSelect({ className = "" }: { className?: string }) {
  const t = useT();
  const router = useRouter();
  const current = useLocale();
  const [pending, startTransition] = useTransition();

  return (
    <select
      aria-label={t("common.language")}
      value={current}
      disabled={pending}
      onChange={(event) => {
        const next = event.target.value;
        if (!isLocale(next)) return;
        writeLocaleCookieInBrowser(next);
        startTransition(async () => {
          await setLanguage(next);
          router.refresh();
        });
      }}
      className={`rounded-lg border border-neutral-200 bg-white px-2 py-1.5 text-sm text-neutral-900 dark:border-night-border dark:bg-night-surface dark:text-night-text ${className}`}
    >
      {LOCALES.map((locale) => (
        <option key={locale} value={locale} lang={locale}>
          {LOCALE_NAMES[locale]}
        </option>
      ))}
    </select>
  );
}
