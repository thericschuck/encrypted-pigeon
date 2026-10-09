import type { TFunction } from "@/lib/i18n/translate";

/**
 * Display text for pigeon_flights.events entries (see
 * supabase/functions/_shared/pigeon-events.ts for where `type`, `key` and
 * `label` actually come from). Kept separate from that Deno-only file since
 * this one is bundled into the Next.js app.
 *
 * The edge function stores the German label with each event, plus (since the
 * i18n change) a stable `key` such as "customs.1". The UI shows
 * t("chatMisc.event.label.<key>"); flights created before the key existed
 * only carry the German label, which LABEL_TO_KEY maps back to the key.
 */
export type PigeonEventType =
  | "customs"
  | "storm"
  | "falcon_attack"
  | "exhaustion"
  | "signal_loss"
  | "china_border"
  | "tailwind";

const EVENT_TYPES: readonly string[] = [
  "customs",
  "storm",
  "falcon_attack",
  "exhaustion",
  "signal_loss",
  "china_border",
  "tailwind",
];

// German label (as stored in old rows) -> variant key.
const LABEL_TO_KEY: Record<string, string> = {
  "Zollkontrolle am Grenzposten": "customs.1",
  "Gepäckdurchsuchung durch Zollbeamte": "customs.2",
  "Verdächtiges Paket — Zoll schaltet sich ein": "customs.3",
  "Sandsturm zieht auf": "storm.1",
  "Gewitterfront mit Starkregen": "storm.2",
  "Dichter Nebel senkt die Sicht": "storm.3",
  "Falke greift an — knapp entkommen": "falcon_attack.1",
  "Raubvogel im Sturzflug": "falcon_attack.2",
  "Kurze Rastpause auf einem Dach": "exhaustion.1",
  "Erschöpfung — Verschnaufpause nötig": "exhaustion.2",
  "Wasserstopp an einem Brunnen": "exhaustion.3",
  "GPS-Signal verloren": "signal_loss.1",
  "Funkstörung durch Sonnenwind": "signal_loss.2",
  "Magnetkompass spinnt": "signal_loss.3",
  "Grenzkontrolle an der Great Firewall": "china_border.1",
  "Passkontrolle chinesischer Grenzschutz": "china_border.2",
  "Kräftiger Rückenwind": "tailwind.1",
  "Jetstream erwischt": "tailwind.2",
  "Abkürzung über das Tal gefunden": "tailwind.3",
};

/** Translated label of a flight event; falls back to the stored (German) label. */
export function pigeonEventLabel(event: { key?: string; label: string }, t: TFunction): string {
  const key = event.key ?? LABEL_TO_KEY[event.label];
  return key ? t(`chatMisc.event.label.${key}`) : event.label;
}

export function describePigeonEvent(type: string, t: TFunction): string {
  return EVENT_TYPES.includes(type) ? t(`chatMisc.event.desc.${type}`) : t("chatMisc.event.desc.other");
}
