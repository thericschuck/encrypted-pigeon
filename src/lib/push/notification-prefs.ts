/**
 * Which push notifications a user wants — stored per account in
 * pigeon.profiles.notification_prefs and applied server-side by the
 * send-push-notification edge function (which keeps its own copy of these
 * keys; keep both in sync). A type that's missing counts as switched on.
 */

export type NotificationType =
  | "chat"
  | "letter_incoming"
  | "letter_arrived"
  | "own_arrived"
  | "incident";

export type NotificationPrefs = Partial<Record<NotificationType, boolean>>;

export const NOTIFICATION_OPTIONS: { type: NotificationType; label: string; description: string }[] = [
  { type: "chat", label: "Neue Nachrichten", description: "Normale Chat-Nachrichten, mit Vorschau." },
  {
    type: "letter_incoming",
    label: "Taube im Anflug",
    description: "Jemand hat dir einen Brief geschickt, die Taube ist unterwegs.",
  },
  {
    type: "letter_arrived",
    label: "Brief angekommen",
    description: "Ein Brief an dich ist gelandet und kann gelesen werden.",
  },
  {
    type: "own_arrived",
    label: "Deine Taube ist angekommen",
    description: "Dein eigener Brief wurde zugestellt.",
  },
  {
    type: "incident",
    label: "Zwischenfälle unterwegs",
    description: "Höchstens einer pro Flug, z. B. Gegenwind oder ein Falke.",
  },
];

export function isNotificationEnabled(prefs: NotificationPrefs, type: NotificationType): boolean {
  return prefs[type] !== false;
}

/** Tolerates null / malformed JSON from the database. */
export function parseNotificationPrefs(value: unknown): NotificationPrefs {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const prefs: NotificationPrefs = {};
  for (const option of NOTIFICATION_OPTIONS) {
    const v = (value as Record<string, unknown>)[option.type];
    if (typeof v === "boolean") prefs[option.type] = v;
  }
  return prefs;
}
