"use client";

import { useEffect, useState } from "react";
import {
  AVAILABILITY_INFO,
  SCHEDULE_CATEGORIES,
  blockTitle,
  statusAt,
  type Occurrence,
  type Schedule,
} from "@/lib/schedule/schedule";
import {
  WEEKDAY_LONG,
  addDays,
  browserTimeZone,
  formatDayMonth,
  formatRelativeTime,
  formatTime,
  mondayOf,
  weekdayOfKey,
  zoneLabel,
  zonedParts,
} from "@/lib/schedule/time";
import { useNow } from "@/lib/schedule/use-now";
import { WeekGrid } from "@/components/schedule/week-grid";

interface ScheduleViewProps {
  schedule: Schedule;
  ownerName: string;
}

function rangeText(occ: Occurrence, zone: string, now: Date) {
  return `${formatRelativeTime(occ.start, now, zone)} – ${formatRelativeTime(occ.end, now, zone)}`;
}

/** Someone's week, read-only, in the viewer's time (or theirs, toggled). */
export function ScheduleView({ schedule, ownerName }: ScheduleViewProps) {
  const now = useNow();
  const [viewerZone, setViewerZone] = useState<string | null>(null);
  const [showOwnerZone, setShowOwnerZone] = useState(false);
  const [weekOffset, setWeekOffset] = useState(0);
  const [selected, setSelected] = useState<Occurrence | null>(null);

  useEffect(() => setViewerZone(browserTimeZone()), []);

  if (!now || !viewerZone) {
    return <div className="h-[60dvh] animate-pulse rounded-2xl bg-neutral-100 dark:bg-night-surface" />;
  }

  const ownerZone = schedule.timezone;
  const sameZone = zonedParts(now, viewerZone).minuteOfDay === zonedParts(now, ownerZone).minuteOfDay;
  const displayZone = showOwnerZone ? ownerZone : viewerZone;
  const weekStart = addDays(mondayOf(zonedParts(now, displayZone).dateKey), weekOffset * 7);
  const status = statusAt(schedule, now);
  const upcomingExceptions = schedule.exceptions
    .filter((e) => e.day >= zonedParts(now, ownerZone).dateKey)
    .sort((a, b) => a.day.localeCompare(b.day));

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-2xl border border-neutral-200 p-4 dark:border-night-border dark:bg-night-surface">
        <p className="text-xs text-neutral-500 dark:text-night-muted">
          Bei {ownerName} ist es gerade{" "}
          <span className="font-semibold text-neutral-800 dark:text-night-text">
            {formatTime(now, ownerZone)} Uhr
          </span>
          {!sameZone && <> ({zoneLabel(ownerZone)})</>}
        </p>
        {status ? (
          <div className="mt-2 flex items-start gap-3">
            <span className="text-2xl leading-none">{SCHEDULE_CATEGORIES[status.current.block.category].emoji}</span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">{blockTitle(status.current.block)}</p>
              <p className="flex items-center gap-1.5 text-xs text-neutral-600 dark:text-night-muted">
                <span
                  aria-hidden="true"
                  className={`h-2 w-2 rounded-full ${AVAILABILITY_INFO[status.current.block.availability].dotClass}`}
                />
                {AVAILABILITY_INFO[status.current.block.availability].label} · bis{" "}
                {formatRelativeTime(status.current.end, now, viewerZone)}
                {!sameZone && " (deine Zeit)"}
              </p>
              {status.availableAt && status.availableAt.getTime() !== status.current.end.getTime() && (
                <p className="mt-0.5 text-xs text-neutral-500 dark:text-night-muted">
                  Wieder erreichbar ab {formatRelativeTime(status.availableAt, now, viewerZone)}
                </p>
              )}
            </div>
          </div>
        ) : (
          <p className="mt-2 text-sm text-neutral-600 dark:text-night-muted">Gerade kein Eintrag im Plan.</p>
        )}
      </section>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setWeekOffset((w) => w - 1)}
            aria-label="Vorige Woche"
            className="rounded-full p-1.5 text-neutral-500 hover:bg-neutral-100 dark:text-night-muted dark:hover:bg-night-raised"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => setWeekOffset(0)}
            className="min-w-[7.5rem] text-center text-xs font-medium"
          >
            {weekOffset === 0 ? "Diese Woche" : `${formatDayMonth(weekStart)} – ${formatDayMonth(addDays(weekStart, 6))}`}
          </button>
          <button
            type="button"
            onClick={() => setWeekOffset((w) => w + 1)}
            aria-label="Nächste Woche"
            className="rounded-full p-1.5 text-neutral-500 hover:bg-neutral-100 dark:text-night-muted dark:hover:bg-night-raised"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>

        {!sameZone && (
          <div className="flex rounded-full bg-neutral-100 p-0.5 text-xs dark:bg-night-raised">
            {[
              { value: false, label: "Deine Zeit" },
              { value: true, label: `${zoneLabel(ownerZone)}` },
            ].map((option) => (
              <button
                key={String(option.value)}
                type="button"
                onClick={() => setShowOwnerZone(option.value)}
                aria-pressed={showOwnerZone === option.value}
                className={`rounded-full px-3 py-1 ${
                  showOwnerZone === option.value
                    ? "bg-white font-medium shadow-sm dark:bg-night-surface"
                    : "text-neutral-500 dark:text-night-muted"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <WeekGrid
        schedule={schedule}
        displayZone={displayZone}
        weekStart={weekStart}
        now={now}
        selectedBlockId={selected?.block.id}
        onSelect={(occ) => setSelected((current) => (current?.block.id === occ.block.id && current.start.getTime() === occ.start.getTime() ? null : occ))}
      />

      {selected && (
        <section className="animate-fade-in rounded-2xl border border-neutral-200 p-3 text-sm dark:border-night-border dark:bg-night-surface">
          <p className="font-semibold">
            {SCHEDULE_CATEGORIES[selected.block.category].emoji} {blockTitle(selected.block)}
          </p>
          <p className="text-xs text-neutral-600 dark:text-night-muted">
            {AVAILABILITY_INFO[selected.block.availability].label}
          </p>
          <p className="mt-1 text-xs">
            {WEEKDAY_LONG[weekdayOfKey(zonedParts(selected.start, viewerZone).dateKey) - 1]}, {rangeText(selected, viewerZone, selected.start)}
            {!sameZone && " deine Zeit"}
          </p>
          {!sameZone && (
            <p className="text-xs text-neutral-500 dark:text-night-muted">
              {WEEKDAY_LONG[weekdayOfKey(zonedParts(selected.start, ownerZone).dateKey) - 1]}, {rangeText(selected, ownerZone, selected.start)} in {zoneLabel(ownerZone)}
            </p>
          )}
        </section>
      )}

      {upcomingExceptions.length > 0 && (
        <section className="flex flex-col gap-1">
          <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-neutral-400 dark:text-night-muted">
            Besondere Tage
          </h2>
          <ul className="flex flex-col gap-1">
            {upcomingExceptions.map((exception) => (
              <li key={exception.day} className="rounded-xl bg-neutral-50 px-3 py-2 text-xs dark:bg-night-surface">
                <span className="font-medium">
                  ✱ {WEEKDAY_LONG[weekdayOfKey(exception.day) - 1]}, {formatDayMonth(exception.day)}
                </span>
                {exception.note && <span className="text-neutral-600 dark:text-night-muted"> · {exception.note}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
