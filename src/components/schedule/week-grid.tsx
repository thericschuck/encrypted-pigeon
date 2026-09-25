"use client";

import { useEffect, useRef } from "react";
import {
  AVAILABILITY_INFO,
  SCHEDULE_CATEGORIES,
  blockTitle,
  exceptionFor,
  segmentsForDay,
  type Occurrence,
  type Schedule,
} from "@/lib/schedule/schedule";
import { MINUTES_PER_DAY, WEEKDAY_SHORT, addDays, formatDayMonth, zonedParts } from "@/lib/schedule/time";

const HOUR_PX = 32;
const GRID_HEIGHT = 24 * HOUR_PX;
const GRID_COLUMNS = "2.25rem repeat(7, minmax(0, 1fr))";
// Blocks at least this tall also show their title, not just the emoji.
const TITLE_MIN_PX = 30;

interface WeekGridProps {
  schedule: Schedule;
  /** Zone the grid is drawn in (the viewer's or the owner's). */
  displayZone: string;
  /** Monday of the shown week, as a day in displayZone. */
  weekStart: string;
  now: Date | null;
  selectedBlockId?: string | null;
  onSelect?: (occurrence: Occurrence) => void;
}

/** Mo–So with every block placed at its time in `displayZone`. */
export function WeekGrid({ schedule, displayZone, weekStart, now, selectedBlockId, onSelect }: WeekGridProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const nowParts = now ? zonedParts(now, displayZone) : null;
  const hasNow = nowParts !== null;

  // Open on the interesting part of the day: shortly before now, or at
  // 06:00 before the time is known.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const minute = nowParts ? nowParts.minuteOfDay - 120 : 6 * 60;
    el.scrollTop = Math.max(0, (minute / 60) * HOUR_PX);
    // Only once the time is known, not on every tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasNow, displayZone]);

  return (
    <div className="overflow-hidden rounded-2xl border border-neutral-200 dark:border-night-border dark:bg-night-surface">
      <div className="grid border-b border-neutral-200 dark:border-night-border" style={{ gridTemplateColumns: GRID_COLUMNS }}>
        <div />
        {days.map((day, i) => {
          const isToday = nowParts?.dateKey === day;
          const exception = exceptionFor(schedule, day);
          return (
            <div
              key={day}
              title={exception ? `Ausnahme${exception.note ? `: ${exception.note}` : ""}` : undefined}
              className={`flex flex-col items-center py-1.5 text-[11px] leading-tight ${
                isToday ? "font-semibold text-[#b0532b] dark:text-night-accent" : "text-neutral-500 dark:text-night-muted"
              }`}
            >
              <span>
                {WEEKDAY_SHORT[i]}
                {exception && <span aria-label="Ausnahme"> ✱</span>}
              </span>
              <span className="text-[10px] opacity-80">{formatDayMonth(day)}</span>
            </div>
          );
        })}
      </div>

      <div ref={scrollRef} className="max-h-[60dvh] overflow-y-auto">
        <div className="relative grid" style={{ gridTemplateColumns: GRID_COLUMNS, height: GRID_HEIGHT }}>
          <div className="relative">
            {Array.from({ length: 23 }, (_, i) => i + 1).map((hour) => (
              <span
                key={hour}
                className="absolute right-1 -translate-y-1/2 text-[9px] tabular-nums text-neutral-400 dark:text-night-muted"
                style={{ top: hour * HOUR_PX }}
              >
                {String(hour).padStart(2, "0")}
              </span>
            ))}
          </div>

          {days.map((day) => {
            const isToday = nowParts?.dateKey === day;
            return (
              <div
                key={day}
                className={`relative border-l border-neutral-100 dark:border-night-border/60 ${
                  isToday ? "bg-[#c1643a]/[0.04] dark:bg-night-accent/[0.06]" : ""
                }`}
                style={{
                  backgroundImage: `repeating-linear-gradient(to bottom, transparent 0, transparent ${HOUR_PX - 1}px, rgb(128 128 128 / 0.12) ${HOUR_PX - 1}px, rgb(128 128 128 / 0.12) ${HOUR_PX}px)`,
                }}
              >
                {segmentsForDay(schedule, day, displayZone).map((segment) => {
                  const { block } = segment.occurrence;
                  const category = SCHEDULE_CATEGORIES[block.category];
                  const top = (segment.top / MINUTES_PER_DAY) * GRID_HEIGHT;
                  const height = Math.max(((segment.bottom - segment.top) / MINUTES_PER_DAY) * GRID_HEIGHT, 6);
                  const selected = selectedBlockId === block.id;
                  return (
                    <button
                      key={`${block.id}-${segment.occurrence.start.getTime()}`}
                      type="button"
                      onClick={() => onSelect?.(segment.occurrence)}
                      title={`${category.emoji} ${blockTitle(block)} · ${AVAILABILITY_INFO[block.availability].label}`}
                      className={`absolute inset-x-0.5 overflow-hidden border-l-2 px-0.5 text-left text-[10px] leading-tight ${category.blockClass} ${
                        segment.clippedStart ? "rounded-t-none" : "rounded-t-md"
                      } ${segment.clippedEnd ? "rounded-b-none" : "rounded-b-md"} ${
                        selected ? "z-10 ring-2 ring-[#c1643a] dark:ring-night-accent" : ""
                      }`}
                      style={{ top, height }}
                    >
                      <span
                        aria-hidden="true"
                        className={`absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full ${AVAILABILITY_INFO[block.availability].dotClass}`}
                      />
                      {height >= 14 && <span className="block">{category.emoji}</span>}
                      {height >= TITLE_MIN_PX && <span className="block truncate font-medium">{blockTitle(block)}</span>}
                    </button>
                  );
                })}
                {isToday && nowParts && (
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-x-0 z-20 h-0.5 bg-[#c1643a] dark:bg-night-accent"
                    style={{ top: (nowParts.minuteOfDay / MINUTES_PER_DAY) * GRID_HEIGHT }}
                  >
                    <span className="absolute -left-1 -top-[3px] h-2 w-2 rounded-full bg-[#c1643a] dark:bg-night-accent" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
