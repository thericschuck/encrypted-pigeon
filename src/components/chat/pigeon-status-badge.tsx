"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { createClient } from "@/lib/supabase/client";

interface PigeonStatusBadgeProps {
  messageId: string;
  isOwn: boolean;
  onOpen: () => void;
}

type FlightStatus = "encrypting" | "in_transit" | "delivered";

/**
 * Small per-message indicator, independent of <PigeonFlightMap />: while
 * in_transit it's just the existing "view flight" link, once delivered it
 * becomes a small pigeon badge.
 *
 * Distinguishes "delivered while I was watching" from "delivered while I
 * was away" purely from what this component happens to observe — no
 * persisted "seen" state needed. If it sees the live in_transit->delivered
 * transition (or reasonably recent history right after mount), it briefly
 * highlights as "Gerade angekommen"; if arrival is already old news, it's
 * just a plain badge, per the "no replay for stale arrivals" requirement.
 */
const RECENT_ARRIVAL_WINDOW_MS = 2 * 60 * 1000;
const JUST_ARRIVED_HIGHLIGHT_MS = 4000;

export function PigeonStatusBadge({ messageId, isOwn, onOpen }: PigeonStatusBadgeProps) {
  const [status, setStatus] = useState<FlightStatus | null>(null);
  const [justArrived, setJustArrived] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    supabase
      .from("pigeon_flights")
      .select("status, arrival_time")
      .eq("message_id", messageId)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled || !data) return;
        const row = data as unknown as { status: FlightStatus; arrival_time: string | null };
        setStatus(row.status);
        if (
          row.status === "delivered" &&
          row.arrival_time &&
          Date.now() - new Date(row.arrival_time).getTime() <= RECENT_ARRIVAL_WINDOW_MS
        ) {
          setJustArrived(true);
        }
      });

    const channel = supabase
      .channel(`pigeon-status-${messageId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "pigeon",
          table: "pigeon_flights",
          filter: `message_id=eq.${messageId}`,
        },
        (payload) => {
          const next = payload.new as { status: FlightStatus };
          setStatus((prevStatus) => {
            if (prevStatus === "in_transit" && next.status === "delivered") {
              setJustArrived(true);
            }
            return next.status;
          });
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [messageId]);

  useEffect(() => {
    if (!justArrived) return;
    const timeout = setTimeout(() => setJustArrived(false), JUST_ARRIVED_HIGHLIGHT_MS);
    return () => clearTimeout(timeout);
  }, [justArrived]);

  if (!status || status === "encrypting") return null;

  const linkClass = `text-xs opacity-70 hover:opacity-100 ${isOwn ? "text-white" : "text-neutral-700"}`;

  if (status === "in_transit") {
    return (
      <button type="button" onClick={onOpen} className={linkClass}>
        🕊 Taubenflug ansehen
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
        justArrived ? (isOwn ? "bg-white/20" : "bg-amber-100") : ""
      }`}
    >
      🕊 {justArrived ? "Gerade angekommen" : "Angekommen"}
    </motion.button>
  );
}
