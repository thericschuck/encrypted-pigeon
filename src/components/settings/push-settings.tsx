"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { isIOS, isStandalone } from "@/lib/device";
import {
  getCurrentPushSubscription,
  isPushSupported,
  subscribeToPush,
  unsubscribeFromPush,
} from "@/lib/push/subscribe";
import { sendTestPush, type TestPushResult } from "@/app/actions/push";
import {
  NOTIFICATION_OPTIONS,
  isNotificationEnabled,
  type NotificationPrefs,
  type NotificationType,
} from "@/lib/push/notification-prefs";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import { useT } from "@/lib/i18n/client";
import type { TFunction } from "@/lib/i18n/translate";

interface PushSettingsProps {
  userId: string;
  initialPrefs: NotificationPrefs;
}

type Status = "loading" | "unsupported" | "ios-not-installed" | "denied" | "off" | "on" | "error";

function testResultText(result: TestPushResult, t: TFunction): string {
  if (result.status === "sent") {
    return result.devices === 1
      ? t("settings.push.testSentOne")
      : t("settings.push.testSentMany", { count: result.devices });
  }
  if (result.status === "no-devices") return t("settings.push.testNoDevices");
  return t("settings.push.testFailed", { message: result.message });
}

export function PushSettings({ userId, initialPrefs }: PushSettingsProps) {
  const t = useT();
  const [status, setStatus] = useState<Status>("loading");
  const [busy, setBusy] = useState(false);
  const [prefs, setPrefs] = useState<NotificationPrefs>(initialPrefs);
  const [prefsError, setPrefsError] = useState<string | null>(null);
  const [errorReason, setErrorReason] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  /**
   * "On" means the server can actually reach this device: the browser has
   * a subscription AND it's stored for this account (re-stored here if it
   * isn't — e.g. it was never saved, or removed as stale).
   */
  async function refresh() {
    if (isIOS() && !isStandalone()) {
      setStatus("ios-not-installed");
      return;
    }
    if (!isPushSupported()) {
      setStatus("unsupported");
      return;
    }
    if (Notification.permission === "denied") {
      setStatus("denied");
      return;
    }
    const subscription = await getCurrentPushSubscription();
    if (!subscription || Notification.permission !== "granted") {
      setStatus("off");
      return;
    }
    const result = await subscribeToPush(createClient(), userId, t);
    setErrorReason(result.ok ? null : result.reason);
    setStatus(result.ok ? "on" : "error");
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleEnable() {
    setBusy(true);
    setTestResult(null);
    const permission = await Notification.requestPermission();
    if (permission === "granted") {
      const result = await subscribeToPush(createClient(), userId, t);
      setErrorReason(result.ok ? null : result.reason);
      setStatus(result.ok ? "on" : "error");
    } else {
      await refresh();
    }
    setBusy(false);
  }

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    setTestResult(testResultText(await sendTestPush(), t));
    setTesting(false);
  }

  async function handleDisable() {
    setBusy(true);
    const supabase = createClient();
    await unsubscribeFromPush(supabase);
    await refresh();
    setBusy(false);
  }

  async function setType(type: NotificationType, on: boolean) {
    const previous = prefs;
    const next = { ...prefs, [type]: on };
    setPrefs(next);
    setPrefsError(null);
    const supabase = createClient();
    const { error } = await supabase
      .from("profiles")
      .update({ notification_prefs: next as Record<string, boolean> })
      .eq("id", userId);
    if (error) {
      setPrefs(previous);
      setPrefsError(t("settings.push.prefsSaveFailed"));
    }
  }

  return (
    <div className="rounded-xl border border-neutral-200 p-4 dark:border-night-border dark:bg-night-surface">
      <h2 className="text-sm font-semibold text-neutral-900 dark:text-night-text">{t("settings.push.title")}</h2>
      <p className="mt-1 text-sm text-neutral-500 dark:text-night-muted">
        {t("settings.push.description")}
      </p>

      <div className="mt-3">
        {status === "loading" && <Skeleton className="h-7 w-24 rounded-full" />}

        {status === "ios-not-installed" && (
          <p className="text-sm text-neutral-500 dark:text-night-muted">
            {t("settings.push.iosNotInstalled")}
          </p>
        )}

        {status === "unsupported" && (
          <p className="text-sm text-neutral-500 dark:text-night-muted">
            {t("settings.push.unsupported")}
          </p>
        )}

        {status === "denied" && (
          <p className="text-sm text-neutral-500 dark:text-night-muted">
            {t("settings.push.denied")}
          </p>
        )}

        {status === "off" && (
          <button
            type="button"
            onClick={handleEnable}
            disabled={busy}
            className="rounded-full bg-accent px-3 py-1.5 text-xs font-medium text-on-accent disabled:opacity-50"
          >
            {busy ? t("settings.busy") : t("settings.push.enable")}
          </button>
        )}

        {status === "error" && (
          <div className="flex flex-col items-start gap-2">
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              {errorReason}
            </p>
            <button
              type="button"
              onClick={handleEnable}
              disabled={busy}
              className="rounded-full bg-accent px-3 py-1.5 text-xs font-medium text-on-accent disabled:opacity-50"
            >
              {busy ? t("settings.busy") : t("settings.push.retry")}
            </button>
          </div>
        )}

        {status === "on" && (
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
              {t("settings.push.active")}
            </span>
            <button
              type="button"
              onClick={handleDisable}
              disabled={busy}
              className="rounded-full border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-700 disabled:opacity-50 dark:border-night-border dark:text-night-text"
            >
              {busy ? t("settings.busy") : t("settings.push.disable")}
            </button>
            <button
              type="button"
              onClick={handleTest}
              disabled={testing}
              className="rounded-full border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-700 disabled:opacity-50 dark:border-night-border dark:text-night-text"
            >
              {testing ? t("settings.push.sending") : t("settings.push.sendTest")}
            </button>
          </div>
        )}
        {testResult && (
          <p className="mt-2 text-xs text-neutral-500 dark:text-night-muted">{testResult}</p>
        )}
      </div>

      <div className="mt-4 border-t border-neutral-200 pt-3 dark:border-night-border">
        <p className="text-xs text-neutral-500 dark:text-night-muted">
          {t("settings.push.prefsIntro")}
        </p>
        <ul className="mt-3 flex flex-col gap-3">
          {NOTIFICATION_OPTIONS.map((option) => (
            <li key={option.type} className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm text-neutral-900 dark:text-night-text">{t(option.labelKey)}</p>
                <p className="text-xs text-neutral-500 dark:text-night-muted">{t(option.descriptionKey)}</p>
              </div>
              <ToggleSwitch
                checked={isNotificationEnabled(prefs, option.type)}
                onChange={(on) => void setType(option.type, on)}
                label={t(option.labelKey)}
              />
            </li>
          ))}
        </ul>
        {prefsError && (
          <p role="alert" className="mt-2 text-xs text-red-600 dark:text-red-400">
            {prefsError}
          </p>
        )}
      </div>
    </div>
  );
}
