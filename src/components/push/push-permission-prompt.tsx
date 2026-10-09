"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { isIOS, isStandalone } from "@/lib/device";
import {
  isPushSupported,
  requestPushPermissionAndSubscribe,
  subscribeToPush,
} from "@/lib/push/subscribe";
import { useT } from "@/lib/i18n/client";

const SEEN_STORAGE_KEY = "pigeon-push-prompt-seen";
const SHOW_DELAY_MS = 1200;

interface PushPermissionPromptProps {
  userId: string;
}

/**
 * Shown once, the first time a chat is opened after login (gated by
 * SEEN_STORAGE_KEY, not by route — this is a 1:1-chat app, so "first chat"
 * is effectively "first login"). Explains *why* before the real browser
 * permission dialog fires, per the "friendly explainer first" requirement.
 *
 * iOS Safari only supports Web Push for an installed (standalone) PWA, so a
 * non-standalone iOS visitor gets a hint instead of a dead-end permission
 * prompt.
 */
export function PushPermissionPrompt({ userId }: PushPermissionPromptProps) {
  const t = useT();
  const [visible, setVisible] = useState(false);
  const [mode, setMode] = useState<"ask" | "ios-hint" | null>(null);
  const [requesting, setRequesting] = useState(false);

  useEffect(() => {
    if (typeof Notification === "undefined") return;

    // Permission was already decided in an earlier session: nothing to ask.
    // If it was granted, silently (re)subscribe this device in case it
    // isn't subscribed yet (cleared site data, new device, etc).
    if (Notification.permission === "granted") {
      const supabase = createClient();
      void subscribeToPush(supabase, userId, t);
      return;
    }
    if (Notification.permission === "denied") return;

    let seen = false;
    try {
      seen = localStorage.getItem(SEEN_STORAGE_KEY) === "1";
    } catch {
      // Private browsing / blocked storage — show it every time rather
      // than never.
    }
    if (seen) return;

    const wantsIOSHint = isIOS() && !isStandalone();
    if (!wantsIOSHint && !isPushSupported()) return;

    setMode(wantsIOSHint ? "ios-hint" : "ask");
    const timer = setTimeout(() => setVisible(true), SHOW_DELAY_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  function dismiss() {
    setVisible(false);
    try {
      localStorage.setItem(SEEN_STORAGE_KEY, "1");
    } catch {
      // Worst case it shows again next session.
    }
  }

  async function handleEnable() {
    setRequesting(true);
    const supabase = createClient();
    await requestPushPermissionAndSubscribe(supabase, userId, t);
    setRequesting(false);
    dismiss();
  }

  if (!visible || !mode) return null;

  return (
    <div className="flex items-start gap-3 border-b border-neutral-200 bg-neutral-50 px-4 py-3 dark:border-night-border dark:bg-night-surface">
      <span className="text-xl leading-none">🕊️</span>
      <div className="min-w-0 flex-1">
        {mode === "ios-hint" ? (
          <>
            <p className="text-sm font-medium text-neutral-900 dark:text-night-text">
              {t("settings.pushPrompt.iosTitle")}
            </p>
            <p className="mt-0.5 text-xs text-neutral-500 dark:text-night-muted">
              {t("settings.pushPrompt.iosBody")}
            </p>
          </>
        ) : (
          <>
            <p className="text-sm font-medium text-neutral-900 dark:text-night-text">{t("settings.pushPrompt.askTitle")}</p>
            <p className="mt-0.5 text-xs text-neutral-500 dark:text-night-muted">
              {t("settings.pushPrompt.askBody")}
            </p>
            <button
              type="button"
              onClick={handleEnable}
              disabled={requesting}
              className="mt-2 rounded-full bg-accent px-3 py-1.5 text-xs font-medium text-on-accent disabled:opacity-50"
            >
              {requesting ? t("settings.busy") : t("settings.push.enable")}
            </button>
          </>
        )}
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label={t("settings.pushPrompt.close")}
        className="flex-shrink-0 rounded-full p-1 text-neutral-400 hover:bg-neutral-200 hover:text-neutral-600 dark:text-night-muted dark:hover:bg-night-raised"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          className="h-4 w-4"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}
