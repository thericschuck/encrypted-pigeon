import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, ScheduleAvailability, ScheduleCategory } from "@/lib/supabase/types";
import {
  MINUTES_PER_DAY,
  addDays,
  formatRelativeTime,
  weekdayOfKey,
  zonedParts,
  zonedToInstant,
} from "@/lib/schedule/time";

type PigeonClient = SupabaseClient<Database, "pigeon">;
type BlockRow = Database["pigeon"]["Tables"]["schedule_blocks"]["Row"];

export type ScheduleBlock = Pick<
  BlockRow,
  "id" | "weekday" | "exception_day" | "start_minute" | "end_minute" | "category" | "availability" | "label"
>;

export const SCHEDULE_BLOCK_COLUMNS =
  "id, owner_id, weekday, exception_day, start_minute, end_minute, category, availability, label";

export interface ScheduleException {
  day: string;
  note: string | null;
}

/**
 * One member's Wochenplan, as plain data (it's passed from server to
 * client components). Blocks hold both the weekly template (weekday set)
 * and the blocks of exception days (exception_day set).
 */
export interface Schedule {
  ownerId: string;
  /** The zone all start/end minutes are written in. */
  timezone: string;
  blocks: ScheduleBlock[];
  exceptions: ScheduleException[];
}

export const SLOT_MINUTES = 15;

export interface CategoryInfo {
  label: string;
  emoji: string;
  /** "Eric ist gerade …" */
  activity: string;
  defaultAvailability: ScheduleAvailability;
  /** Block colors in the week grid (full literal class names for Tailwind). */
  blockClass: string;
}

export const SCHEDULE_CATEGORIES: Record<ScheduleCategory, CategoryInfo> = {
  training: {
    label: "Training",
    emoji: "🥋",
    activity: "beim Training",
    defaultAvailability: "unavailable",
    blockClass: "bg-[#f3d9cb] text-[#7a3517] border-[#c1643a] dark:bg-[#4a2a1a] dark:text-[#f2c7ae] dark:border-night-accent",
  },
  freizeit: {
    label: "Freizeit",
    emoji: "☕",
    activity: "in der Freizeit",
    defaultAvailability: "available",
    blockClass: "bg-[#dfe9d6] text-[#2f5129] border-[#3f6b3a] dark:bg-[#26331f] dark:text-[#c8dcb9] dark:border-[#6f9a5f]",
  },
  schlafen: {
    label: "Schlafen",
    emoji: "🌙",
    activity: "am Schlafen",
    defaultAvailability: "unavailable",
    blockClass: "bg-[#d8e3ee] text-[#1f4260] border-[#1f5f8b] dark:bg-[#1c2a36] dark:text-[#b7cde0] dark:border-[#5a8db5]",
  },
  essen: {
    label: "Essen",
    emoji: "🍜",
    activity: "beim Essen",
    defaultAvailability: "limited",
    blockClass: "bg-[#f5e7c4] text-[#6b4d0f] border-[#c29a3a] dark:bg-[#3a3019] dark:text-[#ecd9a6] dark:border-[#c29a3a]",
  },
  unterwegs: {
    label: "Unterwegs",
    emoji: "🚌",
    activity: "unterwegs",
    defaultAvailability: "limited",
    blockClass: "bg-[#e6dcef] text-[#4b2b72] border-[#6b3fa0] dark:bg-[#2d2238] dark:text-[#d4c3e6] dark:border-[#9a74c4]",
  },
  sonstiges: {
    label: "Sonstiges",
    emoji: "📌",
    activity: "beschäftigt",
    defaultAvailability: "limited",
    blockClass: "bg-neutral-100 text-neutral-700 border-neutral-400 dark:bg-night-raised dark:text-night-text dark:border-night-muted",
  },
};

export const CATEGORY_ORDER: ScheduleCategory[] = ["training", "freizeit", "schlafen", "essen", "unterwegs", "sonstiges"];

export const AVAILABILITY_INFO: Record<ScheduleAvailability, { label: string; dotClass: string }> = {
  available: { label: "erreichbar", dotClass: "bg-emerald-500" },
  limited: { label: "eingeschränkt erreichbar", dotClass: "bg-amber-400" },
  unavailable: { label: "nicht erreichbar", dotClass: "bg-neutral-400 dark:bg-night-muted" },
};

export const AVAILABILITY_ORDER: ScheduleAvailability[] = ["available", "limited", "unavailable"];

export function blockTitle(block: Pick<ScheduleBlock, "category" | "label">): string {
  return block.label?.trim() || SCHEDULE_CATEGORIES[block.category].label;
}

/** Length in minutes; a block past midnight wraps (22:00–05:30 = 450). */
export function blockDuration(block: Pick<ScheduleBlock, "start_minute" | "end_minute">): number {
  return (block.end_minute - block.start_minute + MINUTES_PER_DAY) % MINUTES_PER_DAY;
}

export function exceptionFor(schedule: Schedule, dateKey: string): ScheduleException | null {
  return schedule.exceptions.find((e) => e.day === dateKey) ?? null;
}

/**
 * The blocks that start on `dateKey` (a day in the owner's zone): the
 * exception day's own blocks if there is one, otherwise the template of
 * that weekday. Sorted by start.
 */
export function blocksStartingOn(schedule: Schedule, dateKey: string): ScheduleBlock[] {
  const blocks = exceptionFor(schedule, dateKey)
    ? schedule.blocks.filter((b) => b.exception_day === dateKey)
    : schedule.blocks.filter((b) => b.weekday === weekdayOfKey(dateKey));
  return blocks.sort((a, b) => a.start_minute - b.start_minute);
}

export interface Occurrence {
  block: ScheduleBlock;
  start: Date;
  end: Date;
}

/** Every block occurrence overlapping [from, to), sorted by start. */
export function occurrencesBetween(schedule: Schedule, from: Date, to: Date): Occurrence[] {
  const tz = schedule.timezone;
  const firstDay = addDays(zonedParts(from, tz).dateKey, -1);
  const lastDay = zonedParts(to, tz).dateKey;
  const result: Occurrence[] = [];
  for (let day = firstDay; day <= lastDay; day = addDays(day, 1)) {
    for (const block of blocksStartingOn(schedule, day)) {
      const start = zonedToInstant(day, block.start_minute, tz);
      const end = zonedToInstant(day, block.start_minute + blockDuration(block), tz);
      if (end > from && start < to) result.push({ block, start, end });
    }
  }
  return result.sort((a, b) => a.start.getTime() - b.start.getTime());
}

/** The occurrence running at `at` (the most recently started one on overlap). */
function occurrenceAt(occurrences: Occurrence[], at: Date): Occurrence | null {
  let found: Occurrence | null = null;
  for (const occ of occurrences) {
    if (occ.start <= at && occ.end > at) found = occ;
  }
  return found;
}

export interface ScheduleStatus {
  current: Occurrence;
  /**
   * When the member is reachable again: the end of the current stretch of
   * limited/unavailable blocks (a gap without any block counts as
   * reachable). null while reachable now, or if nothing ends within a week.
   */
  availableAt: Date | null;
}

/** What the member is doing at `now`, or null if no block is running. */
export function statusAt(schedule: Schedule, now: Date): ScheduleStatus | null {
  const occurrences = occurrencesBetween(schedule, now, new Date(now.getTime() + 8 * 86_400_000));
  const current = occurrenceAt(occurrences, now);
  if (!current) return null;
  if (current.block.availability === "available") return { current, availableAt: null };

  let t = current.end;
  for (let guard = 0; guard < 100; guard++) {
    const next = occurrenceAt(occurrences, t);
    if (!next || next.block.availability === "available") return { current, availableAt: t };
    t = next.end;
  }
  return { current, availableAt: null };
}

/** "🥋 Training · nicht erreichbar · bis 17:00" (times in `viewerZone`). */
export function describeStatus(status: ScheduleStatus, now: Date, viewerZone: string): string {
  const { block, end } = status.current;
  const category = SCHEDULE_CATEGORIES[block.category];
  return `${category.emoji} ${blockTitle(block)} · ${AVAILABILITY_INFO[block.availability].label} · bis ${formatRelativeTime(end, now, viewerZone)}`;
}

export interface DaySegment {
  occurrence: Occurrence;
  /** Minutes from the start of the shown day, clipped to [0, 1440]. */
  top: number;
  bottom: number;
  /** The occurrence continues from the previous / into the next day. */
  clippedStart: boolean;
  clippedEnd: boolean;
}

/** The pieces of a schedule falling on `dateKey` as seen in `displayZone`. */
export function segmentsForDay(schedule: Schedule, dateKey: string, displayZone: string): DaySegment[] {
  const dayStart = zonedToInstant(dateKey, 0, displayZone);
  const dayEnd = zonedToInstant(addDays(dateKey, 1), 0, displayZone);
  // Positions are wall-clock minutes, so a 23h/25h DST day still lines up
  // with the 24h grid's hour labels.
  const wallMinute = (date: Date) => zonedParts(date, displayZone).minuteOfDay;
  return occurrencesBetween(schedule, dayStart, dayEnd).map((occurrence) => {
    const clippedStart = occurrence.start < dayStart;
    const clippedEnd = occurrence.end >= dayEnd;
    return {
      occurrence,
      top: clippedStart ? 0 : wallMinute(occurrence.start),
      bottom: clippedEnd ? MINUTES_PER_DAY : Math.max(wallMinute(occurrence.end), 1),
      clippedStart,
      clippedEnd: occurrence.end > dayEnd,
    };
  });
}

/**
 * Exceptions before this day are never shown again, so they aren't
 * loaded. Two days back covers every zone's "yesterday" (a block from
 * yesterday can still be running past midnight).
 */
function exceptionCutoff() {
  return addDays(new Date().toISOString().slice(0, 10), -2);
}

/**
 * The Wochenpläne of `owners` the current user may see (RLS decides:
 * own, public, or all for the admin). Members without any entry are left
 * out, so "has a plan" = key present.
 */
export async function loadSchedules(
  supabase: PigeonClient,
  owners: { id: string; timezone: string }[]
): Promise<Record<string, Schedule>> {
  if (owners.length === 0) return {};
  const ids = owners.map((o) => o.id);
  const since = exceptionCutoff();
  const [{ data: blocks }, { data: exceptions }] = await Promise.all([
    supabase
      .from("schedule_blocks")
      .select(SCHEDULE_BLOCK_COLUMNS)
      .in("owner_id", ids)
      .or(`exception_day.is.null,exception_day.gte.${since}`),
    supabase.from("schedule_exceptions").select("owner_id, day, note").in("owner_id", ids).gte("day", since),
  ]);

  const result: Record<string, Schedule> = {};
  const scheduleOf = (ownerId: string) => {
    if (!result[ownerId]) {
      const owner = owners.find((o) => o.id === ownerId);
      result[ownerId] = { ownerId, timezone: owner?.timezone ?? "Europe/Berlin", blocks: [], exceptions: [] };
    }
    return result[ownerId];
  };
  for (const { owner_id, ...block } of blocks ?? []) scheduleOf(owner_id).blocks.push(block);
  for (const { owner_id, ...exception } of exceptions ?? []) scheduleOf(owner_id).exceptions.push(exception);
  return result;
}
