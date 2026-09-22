"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { createClient } from "@/lib/supabase/client";
import { describePigeonEvent } from "@/lib/chat/pigeon-event-descriptions";
import { DecryptionSequence } from "@/components/chat/decryption-sequence";

interface FlightEvent {
  type: string;
  label: string;
  emoji: string;
  timestamp_offset_seconds: number;
  duration_impact_seconds: number;
}

interface FlightRow {
  id: string;
  message_id: string;
  departure_time: string | null;
  arrival_time: string | null;
  duration_seconds: number | null;
  events: FlightEvent[] | null;
  status: "encrypting" | "in_transit" | "delivered";
}

interface PigeonFlightMapProps {
  messageId: string;
  onClose: () => void;
}

// Hand-tuned stylized geography — not accurate, just evocative. All
// coordinates live in this viewBox.
const VIEWBOX = "0 0 800 420";
const DEPARTURE_POINT = { x: 175, y: 165 };
const ARRIVAL_POINT = { x: 655, y: 150 };
const ROUTE_PATH_D = `M ${DEPARTURE_POINT.x} ${DEPARTURE_POINT.y} C 320 15, 470 25, ${ARRIVAL_POINT.x} ${ARRIVAL_POINT.y}`;

const EUROPE_LANDMASS_D =
  "M90,180 C68,118 122,66 192,74 C252,80 272,112 262,150 C256,192 230,232 180,246 C128,260 84,230 90,180 Z";
const ASIA_LANDMASS_D =
  "M560,150 C553,98 610,58 672,64 C732,68 762,112 756,160 C752,212 708,252 654,256 C598,260 565,210 560,150 Z";

// An event stays "active" (cloud + shake on the map) for this long after it
// has occurred.
const ACTIVE_EVENT_WINDOW_SECONDS = 20;
const TICK_MS = 1000;

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function formatRemaining(seconds: number): string {
  if (seconds <= 0) return "Angekommen";
  const minutes = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  if (minutes <= 0) return `${secs}s`;
  return `${minutes} Min ${secs.toString().padStart(2, "0")}s`;
}

function PigeonIcon({ flapping }: { flapping: boolean }) {
  return (
    <g>
      {/* tail */}
      <path d="M -8 1 L -16 -3 L -15 4 Z" fill="#e9dcc3" stroke="#6b5a44" strokeWidth={0.6} />
      {/* wing (flaps) */}
      <path
        d="M -3 -1 C -10 -9 -20 -6 -22 2 C -14 3 -6 3 -3 -1 Z"
        fill="#ddcda8"
        stroke="#6b5a44"
        strokeWidth={0.6}
        className={flapping ? "pigeon-wing" : undefined}
        style={{ transformOrigin: "-3px -1px" }}
      />
      {/* body */}
      <ellipse cx="0" cy="0" rx="9" ry="5.5" fill="#f7ecd9" stroke="#6b5a44" strokeWidth={0.7} />
      {/* head */}
      <circle cx="9" cy="-3" r="3.6" fill="#f7ecd9" stroke="#6b5a44" strokeWidth={0.7} />
      {/* beak */}
      <path d="M 12 -3.5 L 16.5 -2.4 L 12 -1.2 Z" fill="#c9793f" />
      {/* eye */}
      <circle cx="10.3" cy="-4" r="0.7" fill="#3a2f22" />
    </g>
  );
}

function CloudPuff({ x, y }: { x: number; y: number }) {
  return (
    <motion.g
      initial={{ opacity: 0, scale: 0.7 }}
      animate={{ opacity: 0.85, scale: 1 }}
      exit={{ opacity: 0, scale: 0.8 }}
      transition={{ duration: 0.4 }}
      transform={`translate(${x} ${y - 22})`}
    >
      <ellipse cx="-8" cy="0" rx="9" ry="6" fill="#f4f1ea" opacity={0.9} />
      <ellipse cx="4" cy="-3" rx="11" ry="7" fill="#f4f1ea" opacity={0.9} />
      <ellipse cx="14" cy="1" rx="8" ry="5.5" fill="#f4f1ea" opacity={0.9} />
    </motion.g>
  );
}

export function PigeonFlightMap({ messageId, onClose }: PigeonFlightMapProps) {
  const [flight, setFlight] = useState<FlightRow | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [shaking, setShaking] = useState(false);
  const [landing, setLanding] = useState(false);
  const [view, setView] = useState<"map" | "decrypting">("map");
  const pathRef = useRef<SVGPathElement>(null);
  const lastActiveEventKeyRef = useRef<string | null>(null);
  // null until the first status is known, so we can tell "just transitioned
  // to delivered while this was open" apart from "opened an already-old
  // delivered flight" — only the former gets the landing+decrypt show.
  const prevStatusRef = useRef<FlightRow["status"] | null>(null);

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    supabase
      .from("pigeon_flights")
      .select("*")
      .eq("message_id", messageId)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled && data) setFlight(data as FlightRow);
      });

    const channel = supabase
      .channel(`pigeon-flight-${messageId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "pigeon",
          table: "pigeon_flights",
          filter: `message_id=eq.${messageId}`,
        },
        (payload) => setFlight(payload.new as FlightRow)
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [messageId]);

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(interval);
  }, []);

  // Landing + decrypt show plays only for a transition observed live (this
  // map open while status flips in_transit -> delivered). Opening the map
  // for an already-delivered flight later just shows the resting state.
  useEffect(() => {
    if (!flight) return;
    const prevStatus = prevStatusRef.current;
    prevStatusRef.current = flight.status;

    if (prevStatus === "in_transit" && flight.status === "delivered") {
      setLanding(true);
      const landingTimer = setTimeout(() => {
        setLanding(false);
        setView("decrypting");
      }, 1000);
      return () => clearTimeout(landingTimer);
    }
  }, [flight]);

  const events = useMemo(() => flight?.events ?? [], [flight]);

  const departureMs = flight?.departure_time ? new Date(flight.departure_time).getTime() : null;
  const durationSeconds = flight?.duration_seconds ?? null;
  const isDelivered = flight?.status === "delivered";

  const elapsedSeconds =
    departureMs !== null ? Math.max(0, (now - departureMs) / 1000) : 0;
  const t =
    isDelivered || (durationSeconds && elapsedSeconds >= durationSeconds)
      ? 1
      : departureMs !== null && durationSeconds
        ? clamp01(elapsedSeconds / durationSeconds)
        : 0;

  const remainingSeconds = durationSeconds ? Math.max(0, durationSeconds - elapsedSeconds) : null;

  const passedEvents = useMemo(
    () =>
      events
        .filter((e) => e.timestamp_offset_seconds <= elapsedSeconds)
        .sort((a, b) => b.timestamp_offset_seconds - a.timestamp_offset_seconds),
    [events, elapsedSeconds]
  );

  const activeEvent = passedEvents.find(
    (e) => elapsedSeconds - e.timestamp_offset_seconds < ACTIVE_EVENT_WINDOW_SECONDS
  );

  // Trigger a brief shake exactly once per newly-activated event, not on
  // every tick while it stays "active".
  useEffect(() => {
    const key = activeEvent ? `${activeEvent.type}-${activeEvent.timestamp_offset_seconds}` : null;
    if (key && key !== lastActiveEventKeyRef.current) {
      lastActiveEventKeyRef.current = key;
      setShaking(true);
      const timeout = setTimeout(() => setShaking(false), 550);
      return () => clearTimeout(timeout);
    }
  }, [activeEvent]);

  const pigeonPosition = useMemo(() => {
    const path = pathRef.current;
    if (!path) return { x: DEPARTURE_POINT.x, y: DEPARTURE_POINT.y, angle: 0 };
    const length = path.getTotalLength();
    const point = path.getPointAtLength(length * t);
    const lookahead = path.getPointAtLength(Math.min(length, length * t + 1));
    const angle = (Math.atan2(lookahead.y - point.y, lookahead.x - point.x) * 180) / Math.PI;
    return { x: point.x, y: point.y, angle };
    // pathRef.current is stable across renders once mounted; re-run on `t`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t]);

  const isReady = departureMs !== null && durationSeconds !== null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.45, ease: "easeInOut" }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-8"
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97 }}
        transition={{ duration: 0.45, ease: "easeInOut" }}
        className="flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-[#d8c9a3] bg-[#f7f0df] shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-[#e0d3ae] px-5 py-3">
          <div>
            <h2 className="font-serif text-lg text-[#5c4a37]">Taubenflug</h2>
            <p className="text-xs text-[#8a7a5c]">
              {view === "decrypting"
                ? "Nachricht wird entschlüsselt…"
                : isDelivered
                  ? "Angekommen 🎉"
                  : isReady
                    ? `${formatRemaining(remainingSeconds ?? 0)} verbleibend`
                    : "Die Taube wird vorbereitet…"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Schließen"
            className="rounded-full p-2 text-[#8a7a5c] hover:bg-[#ecdfc0]"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <AnimatePresence mode="wait">
          {view === "decrypting" ? (
            <motion.div
              key="decrypting"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.35 }}
            >
              <DecryptionSequence onComplete={onClose} />
            </motion.div>
          ) : (
            <motion.div
              key="map"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.35 }}
              className="overflow-y-auto"
            >
          <div className={`relative ${shaking ? "pigeon-map-shake" : ""}`}>
            <svg viewBox={VIEWBOX} className="w-full" role="img" aria-label="Karte des Taubenflugs">
              <defs>
                <radialGradient id="pigeon-paper-bg" cx="50%" cy="35%" r="75%">
                  <stop offset="0%" stopColor="#faf3df" />
                  <stop offset="100%" stopColor="#eddfbb" />
                </radialGradient>
                <filter id="pigeon-paper-grain">
                  <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" result="noise" />
                  <feColorMatrix in="noise" type="matrix" values="0 0 0 0 0.36  0 0 0 0 0.30  0 0 0 0 0.20  0 0 0 0.05 0" />
                </filter>
                <filter id="pigeon-landmass-blur" x="-30%" y="-30%" width="160%" height="160%">
                  <feGaussianBlur stdDeviation="4" />
                </filter>
              </defs>

              <rect x="0" y="0" width="800" height="420" fill="url(#pigeon-paper-bg)" />
              <rect x="0" y="0" width="800" height="420" filter="url(#pigeon-paper-grain)" opacity={0.5} />

              {/* Watercolor-bleed edge: a soft blurred darker copy beneath each landmass. */}
              <path d={EUROPE_LANDMASS_D} fill="#6f8054" opacity={0.35} filter="url(#pigeon-landmass-blur)" />
              <path d={ASIA_LANDMASS_D} fill="#6f8054" opacity={0.35} filter="url(#pigeon-landmass-blur)" />
              <path d={EUROPE_LANDMASS_D} fill="#8a9b6e" stroke="#5f7048" strokeWidth={1} />
              <path d={ASIA_LANDMASS_D} fill="#8a9b6e" stroke="#5f7048" strokeWidth={1} />

              <text x={175} y={100} textAnchor="middle" className="fill-[#5c4a37] font-serif text-[15px]">
                Deutschland
              </text>
              <text x={655} y={90} textAnchor="middle" className="fill-[#5c4a37] font-serif text-[15px]">
                China
              </text>

              {/* Route */}
              <path
                ref={pathRef}
                d={ROUTE_PATH_D}
                fill="none"
                stroke="#c1643a"
                strokeWidth={2}
                strokeDasharray="6 6"
                opacity={0.75}
              />
              <circle cx={DEPARTURE_POINT.x} cy={DEPARTURE_POINT.y} r={4} fill="#c1643a" />
              <circle cx={ARRIVAL_POINT.x} cy={ARRIVAL_POINT.y} r={4} fill="#c1643a" />

              {isReady && (
                <g transform={`translate(${pigeonPosition.x} ${pigeonPosition.y}) rotate(${pigeonPosition.angle})`} style={{ transition: "transform 0.9s linear" }}>
                  <motion.g
                    animate={landing ? { scale: [1, 1.35, 0.9, 1.05, 1] } : { scale: 1 }}
                    transition={{ duration: 0.9, ease: "easeOut" }}
                  >
                    <PigeonIcon flapping={!isDelivered} />
                  </motion.g>
                </g>
              )}

              <AnimatePresence>
                {activeEvent && isReady && (
                  <CloudPuff x={pigeonPosition.x} y={pigeonPosition.y} />
                )}
              </AnimatePresence>
            </svg>

            {isReady && (
              <div className="absolute inset-x-5 bottom-3">
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#e0d3ae]">
                  <div
                    className="h-full rounded-full bg-[#c1643a] transition-all duration-1000"
                    style={{ width: `${t * 100}%` }}
                  />
                </div>
              </div>
            )}
          </div>

          <div className="space-y-2 px-5 py-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-[#8a7a5c]">
              Reiseprotokoll
            </h3>
            {passedEvents.length === 0 ? (
              <p className="text-sm text-[#8a7a5c]">
                {isReady ? "Noch nichts Aufregendes passiert…" : "Die Taube startet gleich."}
              </p>
            ) : (
              <ul className="space-y-2">
                <AnimatePresence initial={false}>
                  {passedEvents.map((event) => (
                    <motion.li
                      key={`${event.type}-${event.timestamp_offset_seconds}`}
                      initial={{ opacity: 0, y: -6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.35 }}
                      className="flex items-start gap-2.5 rounded-xl border border-[#e0d3ae] bg-white/50 px-3 py-2"
                    >
                      <span className="text-lg leading-none">{event.emoji}</span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-[#5c4a37]">{event.label}</p>
                        <p className="text-xs text-[#8a7a5c]">{describePigeonEvent(event.type)}</p>
                      </div>
                      <span
                        className={`flex-shrink-0 text-xs font-medium ${
                          event.duration_impact_seconds < 0 ? "text-emerald-700" : "text-[#8a7a5c]"
                        }`}
                      >
                        {event.duration_impact_seconds < 0 ? "−" : "+"}
                        {Math.round(Math.abs(event.duration_impact_seconds) / 60) || 1} Min
                      </span>
                    </motion.li>
                  ))}
                </AnimatePresence>
              </ul>
            )}
          </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </motion.div>
  );
}
