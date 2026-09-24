/**
 * Which app sounds play — per device (localStorage), since sound is about
 * where you are right now (office laptop muted, phone on), not about the
 * account. Read synchronously by lib/chat/chime-sounds.ts right inside the
 * send gesture, so no async lookup can get in the way of iOS's audio rules.
 */

export type SoundKey = "send" | "encrypted" | "takeoff";

export interface SoundSettings {
  /** Master switch: off silences everything below. */
  enabled: boolean;
  sounds: Record<SoundKey, boolean>;
}

export const SOUND_OPTIONS: { key: SoundKey; label: string; description: string }[] = [
  {
    key: "send",
    label: "Senden",
    description: "Terminal-Piepen, wenn die Verschlüsselung einer Nachricht startet.",
  },
  {
    key: "encrypted",
    label: "Verschlüsselt & übertragen",
    description: "Abschluss-Ton, wenn die Hacker-Show einer Nachricht fertig ist.",
  },
  {
    key: "takeoff",
    label: "Taube fliegt los",
    description: "Wenn du einen Brief per Brieftaube abschickst.",
  },
];

const STORAGE_KEY = "pigeon.sound-settings.v1";

const DEFAULT_SETTINGS: SoundSettings = {
  enabled: true,
  sounds: { send: true, encrypted: true, takeoff: true },
};

let current: SoundSettings | null = null;
const listeners = new Set<() => void>();

function load(): SoundSettings {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<SoundSettings>;
    // Merge over the defaults, so sounds added later start switched on.
    return {
      enabled: parsed.enabled ?? DEFAULT_SETTINGS.enabled,
      sounds: { ...DEFAULT_SETTINGS.sounds, ...parsed.sounds },
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function getSoundSettings(): SoundSettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  current ??= load();
  return current;
}

/** Server snapshot for useSyncExternalStore (no localStorage there). */
export function getDefaultSoundSettings(): SoundSettings {
  return DEFAULT_SETTINGS;
}

export function setSoundSettings(next: SoundSettings) {
  current = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage blocked: still applies for this session.
  }
  listeners.forEach((listener) => listener());
}

export function subscribeToSoundSettings(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function isSoundEnabled(key: SoundKey): boolean {
  const settings = getSoundSettings();
  return settings.enabled && settings.sounds[key];
}
