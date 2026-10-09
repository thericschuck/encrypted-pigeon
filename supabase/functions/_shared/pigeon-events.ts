/**
 * Event pool for the pigeon-flight simulation (start-pigeon-flight edge
 * function). Each category has 2-3 variants; add more anywhere without
 * touching the function itself.
 *
 * duration_impact is in SECONDS, added to the flight's base duration.
 * Negative values (Rückenwind) shorten the flight.
 *
 * Display text is German here (stored with the flight); the app translates
 * it through `key`, see src/lib/chat/pigeon-event-descriptions.ts.
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
  /**
   * Stable id of this variant ("customs.1"), stored on the flight event so
   * the app can show the label in the viewer's language (the app has the
   * translations under chatMisc.event.label.<key>). `label` stays the German
   * text: it is what old flights and anything that doesn't know the key show.
   * Never renumber — only append new variants.
   */
  key: string;
  label: string;
  emoji: string;
  /** Inclusive [min, max] duration impact range, in seconds. */
  durationImpactRange: [number, number];
}

export const PIGEON_EVENT_POOL: PigeonEventTemplate[] = [
  // Zollkontrolle (+3-5 Min)
  { type: "customs", key: "customs.1", label: "Zollkontrolle am Grenzposten", emoji: "🛂", durationImpactRange: [180, 300] },
  { type: "customs", key: "customs.2", label: "Gepäckdurchsuchung durch Zollbeamte", emoji: "🧳", durationImpactRange: [180, 300] },
  { type: "customs", key: "customs.3", label: "Verdächtiges Paket — Zoll schaltet sich ein", emoji: "📦", durationImpactRange: [180, 300] },

  // Unwetter/Sandsturm (+5-10 Min)
  { type: "storm", key: "storm.1", label: "Sandsturm zieht auf", emoji: "🌪️", durationImpactRange: [300, 600] },
  { type: "storm", key: "storm.2", label: "Gewitterfront mit Starkregen", emoji: "⛈️", durationImpactRange: [300, 600] },
  { type: "storm", key: "storm.3", label: "Dichter Nebel senkt die Sicht", emoji: "🌫️", durationImpactRange: [300, 600] },

  // Falkenangriff (kurzer Schreck, kaum Zeitverlust)
  { type: "falcon_attack", key: "falcon_attack.1", label: "Falke greift an — knapp entkommen", emoji: "🦅", durationImpactRange: [10, 45] },
  { type: "falcon_attack", key: "falcon_attack.2", label: "Raubvogel im Sturzflug", emoji: "🦅", durationImpactRange: [10, 45] },

  // Erschöpfung/Rastpause (+2-4 Min)
  { type: "exhaustion", key: "exhaustion.1", label: "Kurze Rastpause auf einem Dach", emoji: "😮‍💨", durationImpactRange: [120, 240] },
  { type: "exhaustion", key: "exhaustion.2", label: "Erschöpfung — Verschnaufpause nötig", emoji: "🪶", durationImpactRange: [120, 240] },
  { type: "exhaustion", key: "exhaustion.3", label: "Wasserstopp an einem Brunnen", emoji: "💧", durationImpactRange: [120, 240] },

  // Funkstörung/GPS-Verlust (+3-6 Min)
  { type: "signal_loss", key: "signal_loss.1", label: "GPS-Signal verloren", emoji: "📡", durationImpactRange: [180, 360] },
  { type: "signal_loss", key: "signal_loss.2", label: "Funkstörung durch Sonnenwind", emoji: "📻", durationImpactRange: [180, 360] },
  { type: "signal_loss", key: "signal_loss.3", label: "Magnetkompass spinnt", emoji: "🧭", durationImpactRange: [180, 360] },

  // Grenzkontrolle China (+3-5 Min)
  { type: "china_border", key: "china_border.1", label: "Grenzkontrolle an der Great Firewall", emoji: "🚧", durationImpactRange: [180, 300] },
  { type: "china_border", key: "china_border.2", label: "Passkontrolle chinesischer Grenzschutz", emoji: "🛃", durationImpactRange: [180, 300] },

  // Rückenwind-Bonus (–3-5 Min, positiv)
  { type: "tailwind", key: "tailwind.1", label: "Kräftiger Rückenwind", emoji: "💨", durationImpactRange: [-300, -180] },
  { type: "tailwind", key: "tailwind.2", label: "Jetstream erwischt", emoji: "🌬️", durationImpactRange: [-300, -180] },
  { type: "tailwind", key: "tailwind.3", label: "Abkürzung über das Tal gefunden", emoji: "🗺️", durationImpactRange: [-300, -180] },
];
