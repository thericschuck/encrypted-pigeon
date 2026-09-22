"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";

interface DecryptionSequenceProps {
  /** Fires once the short reversed terminal show has played out. */
  onComplete: () => void;
}

// Fixed (not randomized, unlike EncryptionSequence) — the arrival show is
// meant to read as "the same sequence in reverse", not a fresh variant.
const LINES = ["> DECRYPTING MESSAGE...", "> MESSAGE VERIFIED", "🕊️ DELIVERED."];

const LINE_DELAY_MS = 700;
const FINAL_PAUSE_MS = 600;

export function DecryptionSequence({ onComplete }: DecryptionSequenceProps) {
  const [revealedCount, setRevealedCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];

    function showLine(index: number) {
      if (cancelled) return;
      setRevealedCount(index + 1);
      if (index + 1 >= LINES.length) {
        timers.push(
          setTimeout(() => {
            if (!cancelled) onComplete();
          }, FINAL_PAUSE_MS)
        );
        return;
      }
      timers.push(setTimeout(() => showLine(index + 1), LINE_DELAY_MS));
    }

    timers.push(setTimeout(() => showLine(0), 200));
    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="encryption-scanlines encryption-flicker relative flex min-h-[280px] flex-col items-center justify-center gap-2 bg-black px-5 py-10 font-mono text-sm text-green-400">
      {LINES.slice(0, revealedCount).map((line, index) => (
        <motion.div
          key={index}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className={index === LINES.length - 1 ? "text-base text-emerald-300" : ""}
        >
          {line}
        </motion.div>
      ))}
    </div>
  );
}
