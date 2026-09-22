/**
 * Event pool for the pigeon-flight simulation (start-pigeon-flight edge
 * function). Each category has 2-3 variants; add more anywhere without
 * touching the function itself.
 *
 * duration_impact is in SECONDS, added to the flight's base duration.
 * Negative values (Rückenwind) shorten the flight.
 */
export type PigeonEventType =
  | "customs"
  | "storm"
  | "falcon_attack"
  | "exhaustion"
  | "signal_loss"
  | "china_border"
  | "tailwind";

export interface PigeonEventTemplate {
  type: PigeonEventType;
  label: string;
  emoji: string;
  /** Inclusive [min, max] duration impact range, in seconds. */
  durationImpactRange: [number, number];
}

export const PIGEON_EVENT_POOL: PigeonEventTemplate[] = [
  // Zollkontrolle (+3-5 Min)
  { type: "customs", label: "Zollkontrolle am Grenzposten", emoji: "🛂", durationImpactRange: [180, 300] },
  { type: "customs", label: "Gepäckdurchsuchung durch Zollbeamte", emoji: "🧳", durationImpactRange: [180, 300] },
  { type: "customs", label: "Verdächtiges Paket — Zoll schaltet sich ein", emoji: "📦", durationImpactRange: [180, 300] },

  // Unwetter/Sandsturm (+5-10 Min)
  { type: "storm", label: "Sandsturm zieht auf", emoji: "🌪️", durationImpactRange: [300, 600] },
  { type: "storm", label: "Gewitterfront mit Starkregen", emoji: "⛈️", durationImpactRange: [300, 600] },
  { type: "storm", label: "Dichter Nebel senkt die Sicht", emoji: "🌫️", durationImpactRange: [300, 600] },

  // Falkenangriff (kurzer Schreck, kaum Zeitverlust)
  { type: "falcon_attack", label: "Falke greift an — knapp entkommen", emoji: "🦅", durationImpactRange: [10, 45] },
  { type: "falcon_attack", label: "Raubvogel im Sturzflug", emoji: "🦅", durationImpactRange: [10, 45] },

  // Erschöpfung/Rastpause (+2-4 Min)
  { type: "exhaustion", label: "Kurze Rastpause auf einem Dach", emoji: "😮‍💨", durationImpactRange: [120, 240] },
  { type: "exhaustion", label: "Erschöpfung — Verschnaufpause nötig", emoji: "🪶", durationImpactRange: [120, 240] },
  { type: "exhaustion", label: "Wasserstopp an einem Brunnen", emoji: "💧", durationImpactRange: [120, 240] },

  // Funkstörung/GPS-Verlust (+3-6 Min)
  { type: "signal_loss", label: "GPS-Signal verloren", emoji: "📡", durationImpactRange: [180, 360] },
  { type: "signal_loss", label: "Funkstörung durch Sonnenwind", emoji: "📻", durationImpactRange: [180, 360] },
  { type: "signal_loss", label: "Magnetkompass spinnt", emoji: "🧭", durationImpactRange: [180, 360] },

  // Grenzkontrolle China (+3-5 Min)
  { type: "china_border", label: "Grenzkontrolle an der Great Firewall", emoji: "🚧", durationImpactRange: [180, 300] },
  { type: "china_border", label: "Passkontrolle chinesischer Grenzschutz", emoji: "🛃", durationImpactRange: [180, 300] },

  // Rückenwind-Bonus (–3-5 Min, positiv)
  { type: "tailwind", label: "Kräftiger Rückenwind", emoji: "💨", durationImpactRange: [-300, -180] },
  { type: "tailwind", label: "Jetstream erwischt", emoji: "🌬️", durationImpactRange: [-300, -180] },
  { type: "tailwind", label: "Abkürzung über das Tal gefunden", emoji: "🗺️", durationImpactRange: [-300, -180] },
];
