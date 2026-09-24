"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  TRANSMIT_LINES,
  MID_SEQUENCE_LINES,
  type EncryptionLineTemplate,
} from "@/lib/chat/encryption-lines";
import { playEncryptEnd, preloadChimeSounds } from "@/lib/chat/chime-sounds";

interface EncryptionSequenceProps {
  /** Fires once the full sequence (lines + closing pause) has played out,
   * or right away when the terminal is tapped. */
  onComplete: () => void;
}

function shuffled<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// 6-9 mid lines + the 2 closing lines lands the whole sequence around 4-7s
// (see per-line delays below), without hand-tuning an exact total.
function pickSequence(): EncryptionLineTemplate[] {
  const midCount = 6 + Math.floor(Math.random() * 4);
  return [...shuffled(MID_SEQUENCE_LINES).slice(0, midCount), ...TRANSMIT_LINES];
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

// Only the newest few lines stay visible so the in-chat terminal keeps a
// fixed, bubble-sized height instead of growing the conversation.
const VISIBLE_LINE_COUNT = 4;

/**
 * The "hacker" show for one instant chat message, rendered in the chat
 * right where that message sits — the rest of the chat stays usable, and
 * several messages can each run their own sequence at the same time.
 * Starts a fresh randomized sequence on mount.
 */
export function EncryptionSequence({ onComplete }: EncryptionSequenceProps) {
  const [lines] = useState(pickSequence);
  const [revealedCount, setRevealedCount] = useState(0);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  // Set by the running sequence; tapping the terminal ends it early (the
  // message itself was already sent in the background either way).
  const skipRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    preloadChimeSounds();
  }, []);

  useEffect(() => {
    // The start chime is played by the send handler itself (see
    // lib/chat/chime-sounds.ts for why it can't happen here on iOS).
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];

    function showLine(index: number) {
      if (cancelled) return;
      setRevealedCount(index + 1);

      if (index + 1 >= lines.length) {
        timers.push(
          setTimeout(() => {
            if (cancelled) return;
            cancelled = true;
            playEncryptEnd();
            onCompleteRef.current();
          }, FINAL_PAUSE_MS)
        );
        return;
      }

      const delay =
        lines[index].kind === "progress"
          ? PROGRESS_LINE_DELAY_MS
          : LINE_DELAY_MS + Math.random() * LINE_DELAY_JITTER_MS;
      timers.push(setTimeout(() => showLine(index + 1), delay));
    }

    timers.push(setTimeout(() => showLine(0), 200));

    skipRef.current = () => {
      if (cancelled) return;
      cancelled = true;
      timers.forEach(clearTimeout);
      onCompleteRef.current();
    };

    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
      skipRef.current = null;
    };
  }, [lines]);

  const firstVisible = Math.max(0, revealedCount - VISIBLE_LINE_COUNT);
  const visibleLines = useMemo(
    () => lines.slice(firstVisible, revealedCount),
    [lines, firstVisible, revealedCount]
  );

  return (
    <button
      type="button"
      onClick={() => skipRef.current?.()}
      aria-label="Nachricht wird verschlüsselt — tippen zum Überspringen"
      className="encryption-scanlines relative block w-72 max-w-full cursor-pointer overflow-hidden rounded-2xl border border-green-900/60 bg-black px-3 py-2 text-left font-mono text-[11px] leading-snug shadow-[0_0_24px_rgba(0,255,140,0.08)]"
    >
      <div className="mb-1.5 flex items-center gap-1.5 border-b border-green-900/60 pb-1 text-[10px] text-green-600">
        <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
        PIGEON_SECURE_CHANNEL v3.0
      </div>
      {/* Fixed height: 4 lines, a progress line takes two. */}
      <div role="status" className="flex h-[6.5rem] flex-col justify-end gap-1 overflow-hidden">
        {visibleLines.map((line, offset) => (
          <motion.div
            key={firstVisible + offset}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
            className={`whitespace-pre-wrap ${lineColorClass(line.kind)} ${
              line.kind === "warning" ? "encryption-glitch" : ""
            }`}
          >
            {line.kind === "progress" ? (
              <>
                <div className="truncate">{`> ${line.text}`}</div>
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
          className="inline-block h-3 w-1.5 flex-shrink-0 bg-green-500"
        />
      </div>
    </button>
  );
}
