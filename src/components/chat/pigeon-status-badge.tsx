"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import type { FlightRow } from "@/lib/chat/flights";
import { Skeleton } from "@/components/ui/skeleton";

interface PigeonStatusBadgeProps {
  /** undefined = no flight row (yet); see `loading` for "still fetching". */
  flight: FlightRow | undefined;
  /** True until <ChatRoom />'s initial flight fetch has resolved. */
  loading: boolean;
  onOpen: () => void;
}

/**
 * Small indicator under a pigeon letter: while in_transit it's the "view
 * flight" link, once delivered a small pigeon badge. Purely presentational — the
 * flight row (and its realtime updates) come from <ChatRoom />.
 *
 * Distinguishes "delivered while I was watching" from "delivered while I
 * was away" purely from what this component happens to observe — no
 * persisted "seen" state needed. If it sees the live in_transit->delivered
 * transition (or a very recent arrival right after mount), it briefly
 * highlights as "Gerade angekommen"; stale arrivals are just a plain badge.
 */
const RECENT_ARRIVAL_WINDOW_MS = 2 * 60 * 1000;
const JUST_ARRIVED_HIGHLIGHT_MS = 4000;

export function PigeonStatusBadge({ flight, loading, onOpen }: PigeonStatusBadgeProps) {
  const status = flight?.status ?? null;
  const [justArrived, setJustArrived] = useState(false);
  // null until the first known status, so the first observation can be
  // told apart from a live transition.
  const prevStatusRef = useRef<FlightRow["status"] | null>(null);

  useEffect(() => {
    if (!status) return;
    const prevStatus = prevStatusRef.current;
    prevStatusRef.current = status;

    if (prevStatus === "in_transit" && status === "delivered") {
      setJustArrived(true);
    } else if (
      prevStatus === null &&
      status === "delivered" &&
      flight?.arrival_time &&
      Date.now() - new Date(flight.arrival_time).getTime() <= RECENT_ARRIVAL_WINDOW_MS
    ) {
      setJustArrived(true);
    }
  }, [status, flight?.arrival_time]);

  useEffect(() => {
    if (!justArrived) return;
    const timeout = setTimeout(() => setJustArrived(false), JUST_ARRIVED_HIGHLIGHT_MS);
    return () => clearTimeout(timeout);
  }, [justArrived]);

  if (loading && !flight) {
    return <Skeleton className="h-3.5 w-28" />;
  }

  // Letters always render on the parchment bubble, so no own/other colors.
  const linkClass = "text-xs opacity-70 hover:opacity-100";

  // No row yet: the server-side start-pigeon-flight call is usually only a
  // beat behind the letter itself.
  if (!status || status === "encrypting") {
    return <span className="text-xs opacity-60">🕊 Macht sich startklar…</span>;
  }

  if (status === "in_transit") {
    return (
      <button type="button" onClick={onOpen} className={linkClass}>
        🕊 Unterwegs · Flug ansehen
      </button>
    );
  }

  return (
    <motion.button
      type="button"
      onClick={onOpen}
      animate={justArrived ? { scale: [0.85, 1.08, 1] } : undefined}
      transition={{ duration: 0.5 }}
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 transition-colors ${linkClass} ${
        justArrived ? "bg-amber-100 dark:bg-amber-900/40" : ""
      }`}
    >
      🕊 {justArrived ? "Gerade angekommen" : "Angekommen"}
    </motion.button>
  );
}
