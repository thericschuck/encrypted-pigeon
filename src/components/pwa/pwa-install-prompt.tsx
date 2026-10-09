"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { isIOS, isStandalone } from "@/lib/device";
import { promptInstall, useInstallState } from "@/lib/pwa-install";
import { useT } from "@/lib/i18n/client";

const DISMISSED_STORAGE_KEY = "pigeon-pwa-onboarding-dismissed";
const SHOW_DELAY_MS = 1500;

/**
 * One-time, friendly "add to home screen" nudge shown after a user's first
 * login. Device-specific instructions since there's no unified install API:
 * iOS Safari has none at all (Share -> Add to Home Screen is manual), while
 * Chrome/Android fires `beforeinstallprompt`, which lib/pwa-install.ts
 * captures so our own button can trigger it (the settings page has the same
 * button for later).
 */
export function PwaInstallPrompt() {
  const t = useT();
  const [visible, setVisible] = useState(false);
  const [hasSession, setHasSession] = useState(false);
  const { deferredPrompt } = useInstallState();

  useEffect(() => {
    const supabase = createClient();
    // Only decides whether to show the install hint — the locally stored
    // session is enough, no need for a round trip to the Auth server.
    supabase.auth.getSession().then(({ data }) => setHasSession(!!data.session));
  }, []);

  useEffect(() => {
    if (!hasSession || isStandalone()) return;

    let dismissed = false;
    try {
      dismissed = localStorage.getItem(DISMISSED_STORAGE_KEY) === "1";
    } catch {
      // Private browsing / blocked storage — just show it every time rather
      // than crash.
    }
    if (dismissed) return;

    const timer = setTimeout(() => setVisible(true), SHOW_DELAY_MS);
    return () => clearTimeout(timer);
  }, [hasSession]);

  function dismiss() {
    setVisible(false);
    try {
      localStorage.setItem(DISMISSED_STORAGE_KEY, "1");
    } catch {
      // Ignore — worst case it shows again next session.
    }
  }

  async function handleInstallClick() {
    await promptInstall();
    dismiss();
  }

  if (!visible) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
      <div className="w-full max-w-sm rounded-2xl border border-[#d8c9a3] bg-[#f7f0df] p-4 shadow-2xl dark:border-night-border dark:bg-night-surface">
        <div className="flex items-start gap-3">
          <span className="text-2xl leading-none">🕊️</span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-[#5c4a37] dark:text-night-text">{t("settings.pwa.title")}</p>
            {isIOS() ? (
              <p className="mt-1 text-xs text-[#8a7a5c] dark:text-night-muted">
                {t("settings.pwa.iosBefore")}
                <span className="font-medium">{t("settings.pwa.iosShare")}</span>
                {t("settings.pwa.iosMiddle")}
                <span className="font-medium">{t("settings.pwa.iosAdd")}</span>
                {t("settings.pwa.iosAfter")}
              </p>
            ) : deferredPrompt ? (
              <>
                <p className="mt-1 text-xs text-[#8a7a5c] dark:text-night-muted">
                  {t("settings.pwa.deferred")}
                </p>
                <button
                  type="button"
                  onClick={handleInstallClick}
                  className="mt-2 rounded-full bg-[#c1643a] px-3 py-1.5 text-xs font-medium text-white"
                >
                  {t("settings.pwa.installNow")}
                </button>
              </>
            ) : (
              <p className="mt-1 text-xs text-[#8a7a5c] dark:text-night-muted">
                {t("settings.pwa.menuBefore")}
                <span className="font-medium">{t("settings.pwa.menuInstall")}</span>
                {t("settings.pwa.menuAfter")}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={dismiss}
            aria-label={t("settings.pwa.close")}
            className="flex-shrink-0 rounded-full p-1 text-[#8a7a5c] hover:bg-[#ecdfc0] dark:text-night-muted dark:hover:bg-night-raised"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
