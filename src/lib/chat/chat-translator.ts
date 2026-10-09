import type { TFunction } from "@/lib/i18n/translate";

/**
 * Pure (non-React) chat code — the outbox, message previews — has no hook to
 * get the viewer's language from. <OutboxResumer /> (mounted once in the root
 * layout) hands it the current translator here, so errors created long after
 * the component that started the send is gone still come out translated.
 * Browser only; on the server pass `t` explicitly.
 */
let current: TFunction | null = null;

export function setChatTranslator(t: TFunction) {
  current = t;
}

export function getChatTranslator(): TFunction | null {
  return current;
}

/** Translate with the registered translator; the bare key if none is registered yet. */
export const chatT: TFunction = (key, params) => (current ? current(key, params) : key);
