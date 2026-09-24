"use client";

import { useEffect, useRef } from "react";

const GLYPHS =
  "アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワン0123456789ABCDEF";
const FONT_SIZE = 14;
// ~14 steps per second is enough for the effect and cheap on phones.
const STEP_MS = 70;
// How much of the previous frame fades out per step — sets the trail length.
const TRAIL_FADE = 0.1;

function randomGlyph() {
  return GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
}

/**
 * Faint "Matrix" code rain behind the chat. Purely decorative: transparent
 * canvas (the page background shows through), very low opacity, no pointer
 * events, and nothing at all for prefers-reduced-motion. requestAnimationFrame
 * pauses by itself while the tab is in the background.
 *
 * The glyph color comes from the canvas' own CSS `color`, so it follows the
 * light/dark theme without any JS theme logic.
 */
export function CodeRain() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let width = 0;
    let height = 0;
    // Per column: current row (fractional) and rows advanced per step.
    let drops: number[] = [];
    let speeds: number[] = [];
    let raf = 0;
    let lastStep = 0;

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = canvas!.clientWidth;
      height = canvas!.clientHeight;
      canvas!.width = Math.round(width * dpr);
      canvas!.height = Math.round(height * dpr);
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);

      const columns = Math.ceil(width / FONT_SIZE);
      const rows = height / FONT_SIZE;
      // Existing columns keep their place; new ones start somewhere above.
      drops = Array.from({ length: columns }, (_, i) => drops[i] ?? -Math.random() * rows);
      speeds = Array.from({ length: columns }, (_, i) => speeds[i] ?? 0.35 + Math.random() * 0.5);
    }

    function step() {
      // Fade what's there towards transparent instead of painting a
      // background color over it — works on any theme.
      ctx!.globalCompositeOperation = "destination-out";
      ctx!.fillStyle = `rgba(0, 0, 0, ${TRAIL_FADE})`;
      ctx!.fillRect(0, 0, width, height);
      ctx!.globalCompositeOperation = "source-over";

      ctx!.fillStyle = getComputedStyle(canvas!).color;
      ctx!.font = `${FONT_SIZE}px ui-monospace, SFMono-Regular, Menlo, monospace`;

      for (let i = 0; i < drops.length; i += 1) {
        const previousRow = Math.floor(drops[i]);
        drops[i] += speeds[i];
        const row = Math.floor(drops[i]);
        // Only draw when the drop moved into a new cell, so slow columns
        // don't smear the same glyph over itself.
        if (row !== previousRow && row >= 0) {
          ctx!.fillText(randomGlyph(), i * FONT_SIZE, row * FONT_SIZE);
        }
        if (row * FONT_SIZE > height && Math.random() > 0.97) {
          drops[i] = -Math.random() * 8;
        }
      }
    }

    function frame(time: number) {
      raf = requestAnimationFrame(frame);
      if (time - lastStep < STEP_MS) return;
      lastStep = time;
      step();
    }

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="code-rain pointer-events-none absolute inset-0 h-full w-full text-green-700 opacity-[0.07] dark:text-green-400 dark:opacity-[0.1]"
    />
  );
}
