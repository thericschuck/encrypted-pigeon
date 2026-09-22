"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  LAUNCH_LINES,
  MID_SEQUENCE_LINES,
  type EncryptionLineTemplate,
} from "@/lib/chat/encryption-lines";

interface EncryptionSequenceProps {
  /** Show the overlay and (re-)run a fresh randomized sequence. */
  active: boolean;
  /** Fires once the full sequence (lines + closing pause) has played out. */
  onComplete: () => void;
}

const START_SOUND_SRC = "/sounds/encrypt-start.mp3";
const END_SOUND_SRC = "/sounds/encrypt-end.mp3";

// Drop actual files at public/sounds/encrypt-{start,end}.mp3 to enable —
// missing files just fail play() silently below, no crash either way.
function useChimeSounds() {
  const startRef = useRef<HTMLAudioElement | null>(null);
  const endRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    startRef.current = new Audio(START_SOUND_SRC);
    endRef.current = new Audio(END_SOUND_SRC);
    startRef.current.volume = 0.5;
    endRef.current.volume = 0.5;
  }, []);

  return {
    playStart: () => startRef.current?.play().catch(() => {}),
    playEnd: () => endRef.current?.play().catch(() => {}),
  };
}

function shuffled<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// 6-9 mid lines + the 2 launch lines lands the whole sequence around 4-7s
// (see per-line delays below), without hand-tuning an exact total.
function pickSequence(): EncryptionLineTemplate[] {
  const midCount = 6 + Math.floor(Math.random() * 4);
  return [...shuffled(MID_SEQUENCE_LINES).slice(0, midCount), ...LAUNCH_LINES];
}

const BAR_WIDTH = 20;

function AsciiProgressBar({ durationMs }: { durationMs: number }) {
  const [pct, setPct] = useState(0);

  useEffect(() => {
    let raf: number;
    const start = performance.now();
    function tick(now: number) {
      const elapsed = now - start;
      const next = Math.min(100, Math.round((elapsed / durationMs) * 100));
      setPct(next);
      if (next < 100) raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [durationMs]);

  const filled = Math.round((pct / 100) * BAR_WIDTH);
  const bar = "█".repeat(filled) + "░".repeat(BAR_WIDTH - filled);

  return (
    <span className="tabular-nums">
      [{bar}] {pct.toString().padStart(3, " ")}%
    </span>
  );
}

const LINE_DELAY_MS = 480;
const LINE_DELAY_JITTER_MS = 220;
const PROGRESS_LINE_DELAY_MS = 850;
const FINAL_PAUSE_MS = 550;

function lineColorClass(kind: EncryptionLineTemplate["kind"]) {
  switch (kind) {
    case "warning":
      return "text-amber-400";
    case "success":
      return "text-emerald-300";
    default:
      return "text-green-400";
  }
}

export function EncryptionSequence({ active, onComplete }: EncryptionSequenceProps) {
  const [lines, setLines] = useState<EncryptionLineTemplate[]>([]);
  const [revealedCount, setRevealedCount] = useState(0);
  const { playStart, playEnd } = useChimeSounds();
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  useEffect(() => {
    if (!active) {
      setRevealedCount(0);
      return;
    }

    const chosen = pickSequence();
    setLines(chosen);
    setRevealedCount(0);
    playStart();

    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];

    function showLine(index: number) {
      if (cancelled) return;
      setRevealedCount(index + 1);

      if (index + 1 >= chosen.length) {
        timers.push(
          setTimeout(() => {
            if (cancelled) return;
            playEnd();
            onCompleteRef.current();
          }, FINAL_PAUSE_MS)
        );
        return;
      }

      const delay =
        chosen[index].kind === "progress"
          ? PROGRESS_LINE_DELAY_MS
          : LINE_DELAY_MS + Math.random() * LINE_DELAY_JITTER_MS;
      timers.push(setTimeout(() => showLine(index + 1), delay));
    }

    timers.push(setTimeout(() => showLine(0), 300));

    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
    // playStart/playEnd are stable refs from useChimeSounds; re-running this
    // effect on every render would restart the sequence mid-animation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const visibleLines = useMemo(
    () => lines.slice(0, revealedCount),
    [lines, revealedCount]
  );

  return (
    <AnimatePresence>
      {active && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.4, ease: "easeInOut" }}
          className="encryption-flicker fixed inset-0 z-50 flex items-center justify-center bg-black/95 px-6"
        >
          <div className="encryption-scanlines relative w-full max-w-lg overflow-hidden rounded-lg border border-green-900/60 bg-black p-5 font-mono text-sm shadow-[0_0_40px_rgba(0,255,140,0.08)]">
            <div className="mb-3 flex items-center gap-2 border-b border-green-900/60 pb-2 text-xs text-green-600">
              <span className="h-2 w-2 rounded-full bg-green-500" />
              PIGEON_ENCRYPTION_PROTOCOL v2.3
            </div>
            <div className="space-y-1.5">
              {visibleLines.map((line, index) => (
                <motion.div
                  key={index}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.25 }}
                  className={`whitespace-pre-wrap ${lineColorClass(line.kind)} ${
                    line.kind === "warning" ? "encryption-glitch" : ""
                  }`}
                >
                  {line.kind === "progress" ? (
                    <>
                      <div>{`> ${line.text}`}</div>
                      <AsciiProgressBar durationMs={PROGRESS_LINE_DELAY_MS - 100} />
                    </>
                  ) : (
                    line.text
                  )}
                </motion.div>
              ))}
              <motion.span
                animate={{ opacity: [1, 0, 1] }}
                transition={{ duration: 1, repeat: Infinity }}
                className="inline-block h-3.5 w-2 bg-green-500 align-middle"
              />
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
