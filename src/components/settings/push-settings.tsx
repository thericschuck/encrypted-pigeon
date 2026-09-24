"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { isIOS, isStandalone } from "@/lib/device";
import {
  getCurrentPushSubscription,
  isPushSupported,
  requestPushPermissionAndSubscribe,
  unsubscribeFromPush,
} from "@/lib/push/subscribe";
import { Skeleton } from "@/components/ui/skeleton";

interface PushSettingsProps {
  userId: string;
}

type Status = "loading" | "unsupported" | "ios-not-installed" | "denied" | "off" | "on";

export function PushSettings({ userId }: PushSettingsProps) {
  const [status, setStatus] = useState<Status>("loading");
  const [busy, setBusy] = useState(false);

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
    setStatus(subscription && Notification.permission === "granted" ? "on" : "off");
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleEnable() {
    setBusy(true);
    const supabase = createClient();
    await requestPushPermissionAndSubscribe(supabase, userId);
    await refresh();
    setBusy(false);
  }

  async function handleDisable() {
    setBusy(true);
    const supabase = createClient();
    await unsubscribeFromPush(supabase);
    await refresh();
    setBusy(false);
  }

  return (
    <div className="rounded-xl border border-neutral-200 p-4 dark:border-night-border dark:bg-night-surface">
      <h2 className="text-sm font-semibold text-neutral-900 dark:text-night-text">Benachrichtigungen</h2>
      <p className="mt-1 text-sm text-neutral-500 dark:text-night-muted">
        Push-Benachrichtigungen für neue Nachrichten und Updates zu deiner Taube (Zwischenfälle
        unterwegs, Ankunft).
      </p>

      <div className="mt-3">
        {status === "loading" && <Skeleton className="h-7 w-24 rounded-full" />}

        {status === "ios-not-installed" && (
          <p className="text-sm text-neutral-500 dark:text-night-muted">
            Auf iPhone/iPad funktionieren Benachrichtigungen nur, wenn Encrypted Pigeon zum
            Home-Bildschirm hinzugefügt wurde (Teilen → „Zum Home-Bildschirm“). Installiere die App
            zuerst, dann kannst du sie hier aktivieren.
          </p>
        )}

        {status === "unsupported" && (
          <p className="text-sm text-neutral-500 dark:text-night-muted">
            Dieser Browser unterstützt leider keine Push-Benachrichtigungen.
          </p>
        )}

        {status === "denied" && (
          <p className="text-sm text-neutral-500 dark:text-night-muted">
            Benachrichtigungen sind für diese Seite in deinem Browser blockiert. Erlaube sie in den
            Website-Einstellungen deines Browsers, um sie hier wieder zu aktivieren.
          </p>
        )}

        {status === "off" && (
          <button
            type="button"
            onClick={handleEnable}
            disabled={busy}
            className="rounded-full bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50 dark:bg-night-accent dark:text-night-bg"
          >
            {busy ? "Einen Moment…" : "Aktivieren"}
          </button>
        )}

        {status === "on" && (
          <div className="flex items-center gap-3">
            <span className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
              ✓ Aktiv auf diesem Gerät
            </span>
            <button
              type="button"
              onClick={handleDisable}
              disabled={busy}
              className="rounded-full border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-700 disabled:opacity-50 dark:border-night-border dark:text-night-text"
            >
              {busy ? "Einen Moment…" : "Deaktivieren"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
