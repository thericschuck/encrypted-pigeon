/**
 * Wall-clock ↔ instant conversion for arbitrary IANA time zones, on top of
 * Intl only (no date library). A Wochenplan is written in its owner's zone
 * ("Mo 05:30 in Asia/Shanghai") and shown in the viewer's, so every
 * conversion goes through here — DST changes on either side (Germany,
 * 25.10.2026) are then handled by the browser's tz database.
 *
 * Dates are passed around as "YYYY-MM-DD" keys, meaning a calendar day in
 * whichever zone the caller is talking about.
 */

export const MINUTES_PER_DAY = 1440;

const formatters = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string) {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

export interface ZonedParts {
  dateKey: string;
  /** ISO weekday, 1 = Monday … 7 = Sunday. */
  weekday: number;
  minuteOfDay: number;
}

function rawParts(ms: number, timeZone: string) {
  const values: Record<string, number> = {};
  for (const part of partsFormatter(timeZone).formatToParts(new Date(ms))) {
    if (part.type !== "literal") values[part.type] = Number(part.value);
  }
  return {
    year: values.year,
    month: values.month,
    day: values.day,
    // Some engines still say "24" for midnight despite h23.
    hour: values.hour % 24,
    minute: values.minute,
  };
}

function keyOf(year: number, month: number, day: number) {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function utcOfKey(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

/** Calendar day, weekday and minute of an instant, as seen in `timeZone`. */
export function zonedParts(date: Date, timeZone: string): ZonedParts {
  const p = rawParts(date.getTime(), timeZone);
  const dateKey = keyOf(p.year, p.month, p.day);
  return { dateKey, weekday: weekdayOfKey(dateKey), minuteOfDay: p.hour * 60 + p.minute };
}

/** Offset of `timeZone` from UTC at an instant, in ms (Shanghai: +8h). */
function offsetAt(ms: number, timeZone: string) {
  const floored = Math.floor(ms / 60_000) * 60_000;
  const p = rawParts(floored, timeZone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - floored;
}

/**
 * The instant a wall clock in `timeZone` shows `minuteOfDay` on `dateKey`.
 * minuteOfDay may be ≥ 1440 (rolls into the next day). A time skipped by a
 * DST jump resolves to just after the jump.
 */
export function zonedToInstant(dateKey: string, minuteOfDay: number, timeZone: string): Date {
  const wall = utcOfKey(dateKey) + minuteOfDay * 60_000;
  const firstGuess = wall - offsetAt(wall, timeZone);
  const offset = offsetAt(firstGuess, timeZone);
  return new Date(wall - offset);
}

export function addDays(dateKey: string, days: number): string {
  const d = new Date(utcOfKey(dateKey) + days * 86_400_000);
  return keyOf(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

export function weekdayOfKey(dateKey: string): number {
  return ((new Date(utcOfKey(dateKey)).getUTCDay() + 6) % 7) + 1;
}

/** Monday of the week containing `dateKey`. */
export function mondayOf(dateKey: string): string {
  return addDays(dateKey, 1 - weekdayOfKey(dateKey));
}

/** The browser's zone (falls back to Berlin, where most members are). */
export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Berlin";
  } catch {
    return "Europe/Berlin";
  }
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** "05:30" for a minute of the day (1440 → "24:00"). */
export function formatMinute(minute: number): string {
  if (minute === MINUTES_PER_DAY) return "24:00";
  const m = ((minute % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

export function formatTime(date: Date, timeZone: string): string {
  return formatMinute(zonedParts(date, timeZone).minuteOfDay);
}

export const WEEKDAY_SHORT = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"] as const;
export const WEEKDAY_LONG = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"] as const;

/**
 * "17:00" if `date` is today in `timeZone` relative to `now`, "morgen
 * 05:30" for tomorrow, otherwise "Mi 05:30".
 */
export function formatRelativeTime(date: Date, now: Date, timeZone: string): string {
  const target = zonedParts(date, timeZone);
  const today = zonedParts(now, timeZone).dateKey;
  const time = formatMinute(target.minuteOfDay);
  if (target.dateKey === today) return time;
  if (target.dateKey === addDays(today, 1)) return `morgen ${time}`;
  return `${WEEKDAY_SHORT[target.weekday - 1]} ${time}`;
}

/** "25.09." */
export function formatDayMonth(dateKey: string): string {
  const [, month, day] = dateKey.split("-");
  return `${day}.${month}.`;
}

/** Short city-ish name of a zone: "Asia/Shanghai" → "Shanghai". */
export function zoneLabel(timeZone: string): string {
  const city = timeZone.split("/").pop() ?? timeZone;
  return city.replace(/_/g, " ");
}
