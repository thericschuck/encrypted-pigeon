"use client";

import Link from "next/link";
import {
  AVAILABILITY_INFO,
  SCHEDULE_CATEGORIES,
  describeStatus,
  statusAt,
  type Schedule,
} from "@/lib/schedule/schedule";
import { browserTimeZone } from "@/lib/schedule/time";
import { useNow } from "@/lib/schedule/use-now";

/**
 * Under the partner's name in the chat header: "🥋 Training · nicht
 * erreichbar · bis 17:00", in the viewer's time. Links to the full week.
 * Renders nothing if the partner has no (visible) plan.
 */
export function HeaderScheduleStatus({ schedule }: { schedule: Schedule | null }) {
  const now = useNow();
  if (!schedule) return null;
  const status = now ? statusAt(schedule, now) : null;

  return (
    <Link
      href={`/schedule/${schedule.ownerId}`}
      className="flex min-w-0 items-center gap-1.5 text-[11px] leading-tight text-neutral-500 hover:text-neutral-700 dark:text-night-muted dark:hover:text-night-text"
    >
      {status && now ? (
        <>
          <span
            aria-hidden="true"
            className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${AVAILABILITY_INFO[status.current.block.availability].dotClass}`}
          />
          <span className="truncate">{describeStatus(status, now, browserTimeZone())}</span>
        </>
      ) : (
        // Also the placeholder before mount, so the header doesn't jump.
        <span className="truncate">🗓️ Wochenplan ansehen</span>
      )}
    </Link>
  );
}

/**
 * Small availability dot on a chat-list avatar (green / yellow / grey).
 * Nothing while no block is running.
 */
export function AvatarScheduleDot({ schedule }: { schedule: Schedule | null | undefined }) {
  const now = useNow(60_000);
  if (!schedule || !now) return null;
  const status = statusAt(schedule, now);
  if (!status) return null;
  const { block } = status.current;
  const category = SCHEDULE_CATEGORIES[block.category];

  return (
    <span
      title={`${category.emoji} ${category.label} · ${AVAILABILITY_INFO[block.availability].label}`}
      className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white dark:border-night-bg ${AVAILABILITY_INFO[block.availability].dotClass}`}
    />
  );
}
