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

/** Labels/descriptions are message keys (settings.push.type.<type>.label / .description). */
export const NOTIFICATION_OPTIONS: { type: NotificationType; labelKey: string; descriptionKey: string }[] = (
  ["chat", "letter_incoming", "letter_arrived", "own_arrived", "incident"] as const
).map((type) => ({
  type,
  labelKey: `settings.push.type.${type}.label`,
  descriptionKey: `settings.push.type.${type}.description`,
}));

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
