/**
 * Display-only flavor text for pigeon_flights.events entries (see
 * supabase/functions/_shared/pigeon-events.ts for where `type` and `label`
 * actually come from). Kept separate from that Deno-only file since this one
 * is bundled into the Next.js app.
 */
export type PigeonEventType =
  | "customs"
  | "storm"
  | "falcon_attack"
  | "exhaustion"
  | "signal_loss"
  | "china_border"
  | "tailwind";

export const PIGEON_EVENT_DESCRIPTIONS: Record<PigeonEventType, string> = {
  customs: "Die Fracht wird gründlich unter die Lupe genommen, bevor es weitergeht.",
  storm: "Der Wind zerrt an den Federn — die Taube kämpft sich tapfer durch.",
  falcon_attack: "Ein Raubvogel taucht auf, doch die Taube weicht im letzten Moment aus.",
  exhaustion: "Kurze Verschnaufpause, bevor es mit frischer Kraft weitergeht.",
  signal_loss: "Die innere Kompassnadel spinnt kurz — Orientierung wird neu gesucht.",
  china_border: "Grenzbeamte prüfen jedes Detail, bevor die Taube weiterdarf.",
  tailwind: "Ein günstiger Wind schiebt kräftig von hinten an.",
};

export function describePigeonEvent(type: string): string {
  return PIGEON_EVENT_DESCRIPTIONS[type as PigeonEventType] ?? "Ein Zwischenfall auf der Reise.";
}
