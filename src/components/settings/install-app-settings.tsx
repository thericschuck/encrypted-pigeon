"use client";

import { useEffect, useState } from "react";
import { isIOS } from "@/lib/device";
import { promptInstall, useInstallState } from "@/lib/pwa-install";

/**
 * "Install as app" in the settings — the permanent home of the one-time
 * <PwaInstallPrompt /> nudge. Hidden once the app runs installed.
 */
export function InstallAppSettings() {
  const { deferredPrompt, installed } = useInstallState();
  const [busy, setBusy] = useState(false);
  // Installed-or-not is only known in the browser; render nothing until
  // then so the installed app never flashes this card.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted || installed) return null;

  async function handleInstall() {
    setBusy(true);
    await promptInstall();
    setBusy(false);
  }

  return (
    <div className="rounded-xl border border-neutral-200 p-4 dark:border-night-border dark:bg-night-surface">
      <h2 className="text-sm font-semibold text-neutral-900 dark:text-night-text">Als App installieren</h2>
      <p className="mt-1 text-sm text-neutral-500 dark:text-night-muted">
        Eigenes Icon auf dem Home-Bildschirm, Vollbild ohne Browserleiste — und auf dem iPhone die
        Voraussetzung für Benachrichtigungen.
      </p>

      <div className="mt-3">
        {deferredPrompt ? (
          <button
            type="button"
            onClick={handleInstall}
            disabled={busy}
            className="rounded-full bg-accent px-3 py-1.5 text-xs font-medium text-on-accent disabled:opacity-50"
          >
            {busy ? "Einen Moment…" : "🕊️ App installieren"}
          </button>
        ) : isIOS() ? (
          <p className="text-sm text-neutral-500 dark:text-night-muted">
            In Safari unten auf <span className="font-medium">Teilen</span> tippen, dann auf{" "}
            <span className="font-medium">„Zum Home-Bildschirm“</span>.
          </p>
        ) : (
          <p className="text-sm text-neutral-500 dark:text-night-muted">
            Öffne das Menü deines Browsers (⋮) und wähle{" "}
            <span className="font-medium">„App installieren“</span> bzw.{" "}
            <span className="font-medium">„Zum Startbildschirm hinzufügen“</span>. Falls der Eintrag
            fehlt, unterstützt dieser Browser keine Installation — in Chrome oder Edge klappt es.
          </p>
        )}
      </div>
    </div>
  );
}
