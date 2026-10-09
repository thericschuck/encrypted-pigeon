import type { TFunction } from "@/lib/i18n/translate";

/**
 * Text pool for <EncryptionBackdrop />, the "hacker" show behind every
 * instant chat message (pigeon letters skip it). Every send picks a random
 * subset of MID_SEQUENCE_LINES (shuffled), then always ends with
 * TRANSMIT_LINES — extend either array for more variety (add the message
 * key to messages/chatMisc.ts), no component changes needed. The texts
 * are message keys; resolveEncryptionLines() turns them into the viewer's
 * language.
 */
export type EncryptionLineKind = "log" | "progress" | "warning" | "success";

export interface EncryptionLineTemplate {
  kind: EncryptionLineKind;
  /** Message key (chatMisc.enc.*). */
  key: string;
}

export interface EncryptionLine {
  kind: EncryptionLineKind;
  text: string;
}

export const MID_SEQUENCE_LINES: EncryptionLineTemplate[] = [
  { kind: "log", key: "chatMisc.enc.m1" },
  { kind: "progress", key: "chatMisc.enc.m2" },
  { kind: "log", key: "chatMisc.enc.m3" },
  { kind: "warning", key: "chatMisc.enc.m4" },
  { kind: "log", key: "chatMisc.enc.m5" },
  { kind: "progress", key: "chatMisc.enc.m6" },
  { kind: "log", key: "chatMisc.enc.m7" },
  { kind: "log", key: "chatMisc.enc.m8" },
  { kind: "log", key: "chatMisc.enc.m9" },
  { kind: "warning", key: "chatMisc.enc.m10" },
  { kind: "log", key: "chatMisc.enc.m11" },
  { kind: "progress", key: "chatMisc.enc.m12" },
  { kind: "log", key: "chatMisc.enc.m13" },
  { kind: "log", key: "chatMisc.enc.m14" },
  { kind: "log", key: "chatMisc.enc.m15" },
  { kind: "log", key: "chatMisc.enc.m16" },
  { kind: "log", key: "chatMisc.enc.m17" },
  { kind: "warning", key: "chatMisc.enc.m18" },
  { kind: "progress", key: "chatMisc.enc.m19" },
  { kind: "log", key: "chatMisc.enc.m20" },
  { kind: "log", key: "chatMisc.enc.m21" },
  { kind: "log", key: "chatMisc.enc.m22" },
  { kind: "progress", key: "chatMisc.enc.m23" },
  { kind: "warning", key: "chatMisc.enc.m24" },
  { kind: "log", key: "chatMisc.enc.m25" },
];

export const TRANSMIT_LINES: EncryptionLineTemplate[] = [
  { kind: "success", key: "chatMisc.enc.t1" },
  { kind: "success", key: "chatMisc.enc.t2" },
];

export function resolveEncryptionLines(templates: EncryptionLineTemplate[], t: TFunction): EncryptionLine[] {
  return templates.map(({ kind, key }) => ({ kind, text: t(key) }));
}
