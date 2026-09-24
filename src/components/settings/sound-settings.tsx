"use client";

import { useSyncExternalStore } from "react";
import {
  SOUND_OPTIONS,
  getDefaultSoundSettings,
  getSoundSettings,
  setSoundSettings,
  subscribeToSoundSettings,
  type SoundKey,
} from "@/lib/sound-settings";
import { previewSound } from "@/lib/chat/chime-sounds";
import { ToggleSwitch } from "@/components/ui/toggle-switch";

export function SoundSettings() {
  const settings = useSyncExternalStore(
    subscribeToSoundSettings,
    getSoundSettings,
    getDefaultSoundSettings
  );

  function setSound(key: SoundKey, on: boolean) {
    setSoundSettings({ ...settings, sounds: { ...settings.sounds, [key]: on } });
  }

  return (
    <div className="rounded-xl border border-neutral-200 p-4 dark:border-night-border dark:bg-night-surface">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-neutral-900 dark:text-night-text">Sounds</h2>
          <p className="mt-1 text-sm text-neutral-500 dark:text-night-muted">
            Gilt nur für dieses Gerät.
          </p>
        </div>
        <ToggleSwitch
          checked={settings.enabled}
          onChange={(on) => setSoundSettings({ ...settings, enabled: on })}
          label="Alle Sounds"
        />
      </div>

      <ul className={`mt-3 flex flex-col gap-3 ${settings.enabled ? "" : "opacity-50"}`}>
        {SOUND_OPTIONS.map((option) => (
          <li key={option.key} className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm text-neutral-900 dark:text-night-text">{option.label}</p>
              <p className="text-xs text-neutral-500 dark:text-night-muted">{option.description}</p>
            </div>
            <button
              type="button"
              onClick={() => previewSound(option.key)}
              aria-label={`${option.label} anhören`}
              title="Anhören"
              className="flex-shrink-0 rounded-full p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600 dark:text-night-muted dark:hover:bg-night-raised dark:hover:text-night-text"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
                <path d="M8 5.14v13.72a1 1 0 0 0 1.5.86l11-6.86a1 1 0 0 0 0-1.72l-11-6.86A1 1 0 0 0 8 5.14Z" />
              </svg>
            </button>
            <ToggleSwitch
              checked={settings.sounds[option.key]}
              onChange={(on) => setSound(option.key, on)}
              label={option.label}
              disabled={!settings.enabled}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
