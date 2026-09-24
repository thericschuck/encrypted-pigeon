import { useEffect, useSyncExternalStore } from "react";
import { isStandalone } from "@/lib/device";

/**
 * Shared "install as app" state for <PwaInstallPrompt /> (the one-time
 * nudge) and the install button in the settings.
 *
 * Chrome/Edge/Android fire `beforeinstallprompt` once per page load, often
 * long before the settings page is open, so the event is kept here in
 * module state instead of inside whichever component happened to be
 * mounted. iOS has no install API at all (manual Share → Home Screen).
 */

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

interface InstallState {
  /** Present when the browser offers a one-click install. */
  deferredPrompt: BeforeInstallPromptEvent | null;
  /** Running as installed app, or installed during this visit. */
  installed: boolean;
}

const SERVER_STATE: InstallState = { deferredPrompt: null, installed: false };

let state: InstallState = SERVER_STATE;
let listening = false;
const listeners = new Set<() => void>();

function update(next: Partial<InstallState>) {
  state = { ...state, ...next };
  listeners.forEach((listener) => listener());
}

function startListening() {
  if (listening || typeof window === "undefined") return;
  listening = true;
  state = { ...state, installed: isStandalone() };
  window.addEventListener("beforeinstallprompt", (event) => {
    // Keep the browser's own mini-infobar out of the way; we show our own.
    event.preventDefault();
    update({ deferredPrompt: event as BeforeInstallPromptEvent });
  });
  window.addEventListener("appinstalled", () => update({ deferredPrompt: null, installed: true }));
}

function subscribe(listener: () => void) {
  startListening();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Opens the browser's install dialog. Resolves to true if the user
 * accepted, false if dismissed or no prompt is available.
 */
export async function promptInstall(): Promise<boolean> {
  const prompt = state.deferredPrompt;
  if (!prompt) return false;
  await prompt.prompt();
  const { outcome } = await prompt.userChoice;
  // A prompt event can only be used once.
  update({ deferredPrompt: null, installed: outcome === "accepted" || state.installed });
  return outcome === "accepted";
}

export function useInstallState(): InstallState {
  // Registering early (on mount of any user) catches the event even if it
  // fires before the first subscriber renders.
  useEffect(startListening, []);
  return useSyncExternalStore(subscribe, () => state, () => SERVER_STATE);
}

// Start as soon as this module loads in the browser — the event can fire
// before React has mounted anything.
startListening();
