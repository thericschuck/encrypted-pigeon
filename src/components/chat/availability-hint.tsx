"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { SCHEDULE_CATEGORIES, statusAt, type Schedule } from "@/lib/schedule/schedule";
import { browserTimeZone, formatRelativeTime } from "@/lib/schedule/time";
import { useNow } from "@/lib/schedule/use-now";

const DISMISS_KEY_PREFIX = "pigeon-availability-hint-dismissed:";

function readDismissedUntil(ownerId: string): number {
  try {
    return Number(localStorage.getItem(DISMISS_KEY_PREFIX + ownerId)) || 0;
  } catch {
    return 0;
  }
}

/**
 * A quiet line above the composer while the partner's plan says they're
 * busy: "🥋 Eric ist gerade beim Training · erreichbar ab ~17:00". Closing
 * it hides it until that busy stretch is over, so it's back only for the
 * next one — never once per message.
 */
export function AvailabilityHint({ schedule, partnerName }: { schedule: Schedule | null; partnerName: string }) {
  const now = useNow();
  const [dismissedUntil, setDismissedUntil] = useState(0);

  useEffect(() => {
    if (schedule) setDismissedUntil(readDismissedUntil(schedule.ownerId));
  }, [schedule]);

  if (!schedule || !now) return null;
  const status = statusAt(schedule, now);
  if (!status || status.current.block.availability === "available") return null;
  if (now.getTime() < dismissedUntil) return null;

  const { block } = status.current;
  const category = SCHEDULE_CATEGORIES[block.category];
  const busyUntil = status.availableAt ?? status.current.end;

  function dismiss() {
    const until = busyUntil.getTime();
    setDismissedUntil(until);
    try {
      localStorage.setItem(DISMISS_KEY_PREFIX + schedule!.ownerId, String(until));
    } catch {
      // Not persisted (private mode) — hidden for this visit anyway.
    }
  }

  return (
    <div className="animate-fade-in mb-2 flex items-center gap-2 rounded-full bg-neutral-100/80 py-1 pl-3 pr-1 text-[11px] text-neutral-500 dark:bg-night-surface dark:text-night-muted">
      <Link href={`/schedule/${schedule.ownerId}`} className="min-w-0 flex-1 truncate hover:underline">
        {category.emoji} {partnerName} ist gerade {category.activity}
        {block.availability === "limited" && " (eingeschränkt erreichbar)"}
        {status.availableAt && <> · erreichbar ab ~{formatRelativeTime(status.availableAt, now, browserTimeZone())}</>}
      </Link>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Hinweis ausblenden"
        className="flex-shrink-0 rounded-full p-1 hover:bg-neutral-200 dark:hover:bg-night-raised"
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-3 w-3">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}
