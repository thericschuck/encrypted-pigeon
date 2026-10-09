"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setLanguage } from "@/app/actions/language";
import { LOCALES, LOCALE_NAMES, writeLocaleCookieInBrowser, type Locale } from "@/lib/i18n/config";
import { useLocale, useT } from "@/lib/i18n/client";

/** Settings card: pick the app language (saved on the profile, applied at once). */
export function LanguageSettings() {
  const t = useT();
  const router = useRouter();
  const current = useLocale();
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);

  function choose(next: Locale) {
    if (next === current || pending) return;
    setFailed(false);
    writeLocaleCookieInBrowser(next);
    startTransition(async () => {
      const result = await setLanguage(next);
      if (!result.ok) setFailed(true);
      router.refresh();
    });
  }

  return (
    <div className="rounded-xl border border-neutral-200 p-4 dark:border-night-border dark:bg-night-surface">
      <h2 className="text-sm font-semibold text-neutral-900 dark:text-night-text">
        {t("common.language")}
      </h2>
      <p className="mt-1 text-sm text-neutral-500 dark:text-night-muted">{t("common.languageHint")}</p>
      <div role="radiogroup" aria-label={t("common.language")} className="mt-3 grid grid-cols-2 gap-2">
        {LOCALES.map((locale) => (
          <button
            key={locale}
            type="button"
            role="radio"
            aria-checked={locale === current}
            disabled={pending}
            lang={locale}
            onClick={() => choose(locale)}
            className={`rounded-lg border px-3 py-2 text-sm transition-colors disabled:opacity-60 ${
              locale === current
                ? "border-accent bg-accent text-on-accent"
                : "border-neutral-200 text-neutral-900 hover:bg-neutral-50 dark:border-night-border dark:text-night-text dark:hover:bg-night-raised"
            }`}
          >
            {LOCALE_NAMES[locale]}
          </button>
        ))}
      </div>
      {failed && (
        <p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-400">
          {t("common.languageSaveFailed")}
        </p>
      )}
    </div>
  );
}
