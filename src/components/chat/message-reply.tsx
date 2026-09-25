"use client";

import { useRef, useState, type PointerEvent, type ReactNode } from "react";

// How far (px) a bubble has to be dragged to the right to start a reply,
// and the most it follows the finger.
const SWIPE_TRIGGER_PX = 56;
const SWIPE_MAX_PX = 80;
// Movement before deciding between "swipe to reply" and scrolling.
const SWIPE_LOCK_PX = 8;

/** What a quote shows: who wrote the quoted message and a one-line preview. */
export interface QuoteInfo {
  author: string;
  preview: string;
  /** Quoted message isn't readable (deleted, or a letter still in the air). */
  unavailable?: boolean;
}

export type QuoteVariant = "own" | "other" | "letter";

const QUOTE_VARIANT_CLASS: Record<QuoteVariant, string> = {
  own: "border-white/70 bg-black/15 hover:bg-black/25",
  other:
    "border-[#c1643a] bg-black/5 hover:bg-black/10 dark:border-night-accent dark:bg-white/5 dark:hover:bg-white/10",
  letter:
    "border-[#c1643a] bg-[#3d3024]/5 hover:bg-[#3d3024]/10 dark:border-night-accent dark:bg-white/5 dark:hover:bg-white/10",
};

/** The quoted message at the top of a reply bubble; clicking jumps to it. */
export function ReplyQuote({
  quote,
  variant,
  onClick,
}: {
  quote: QuoteInfo;
  variant: QuoteVariant;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={`block w-full min-w-0 rounded-lg border-l-[3px] px-2 py-1 text-left transition-colors disabled:cursor-default ${QUOTE_VARIANT_CLASS[variant]}`}
    >
      <span className="block truncate text-xs font-semibold">{quote.author}</span>
      <span className={`block truncate text-xs ${quote.unavailable ? "italic opacity-60" : "opacity-80"}`}>
        {quote.preview}
      </span>
    </button>
  );
}

/** Above the composer while writing a reply. */
export function ReplyComposerPreview({
  title,
  preview,
  onCancel,
}: {
  title: string;
  preview: string;
  onCancel: () => void;
}) {
  return (
    <div className="animate-fade-in mb-2 flex items-center gap-2 rounded-xl border border-neutral-200 bg-neutral-50 p-2 dark:border-night-border dark:bg-night-surface">
      <div className="min-w-0 flex-1 border-l-[3px] border-[#c1643a] pl-2 dark:border-night-accent">
        <span className="block truncate text-xs font-semibold text-[#b0532b] dark:text-night-accent">{title}</span>
        <span className="block truncate text-xs text-neutral-500 dark:text-night-muted">{preview}</span>
      </div>
      <button
        type="button"
        onClick={onCancel}
        aria-label="Antworten abbrechen"
        className="flex-shrink-0 rounded-full p-1 text-neutral-500 hover:bg-neutral-200 dark:text-night-muted dark:hover:bg-night-raised"
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}

function ReplyIcon({ className }: { className: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 14 4 9l5-5" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
    </svg>
  );
}

/**
 * One message row with both ways to reply to it: dragging the bubble to the
 * right on touch screens (like WhatsApp), and a small button next to the
 * bubble on devices with a mouse. touch-action: pan-y leaves vertical
 * scrolling to the browser, so only horizontal drags reach the handlers.
 */
export function ReplyableRow({
  isOwn,
  enabled,
  onReply,
  children,
}: {
  isOwn: boolean;
  enabled: boolean;
  onReply: () => void;
  children: ReactNode;
}) {
  const [offset, setOffset] = useState(0);
  const gesture = useRef<{ id: number; x: number; y: number; swiping: boolean; armed: boolean } | null>(null);

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!enabled || event.pointerType !== "touch") return;
    gesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY, swiping: false, armed: false };
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    const g = gesture.current;
    if (!g || g.id !== event.pointerId) return;
    const dx = event.clientX - g.x;
    const dy = event.clientY - g.y;
    if (!g.swiping) {
      if (Math.abs(dx) < SWIPE_LOCK_PX && Math.abs(dy) < SWIPE_LOCK_PX) return;
      // Mostly vertical or to the left: not a reply gesture.
      if (dx <= 0 || Math.abs(dy) > Math.abs(dx)) {
        gesture.current = null;
        return;
      }
      g.swiping = true;
    }
    const next = Math.min(SWIPE_MAX_PX, Math.max(0, dx));
    const armed = next >= SWIPE_TRIGGER_PX;
    if (armed && !g.armed && typeof navigator !== "undefined" && "vibrate" in navigator) {
      navigator.vibrate(10);
    }
    g.armed = armed;
    setOffset(next);
  }

  function endGesture(event: PointerEvent<HTMLDivElement>) {
    const g = gesture.current;
    if (!g || g.id !== event.pointerId) return;
    gesture.current = null;
    if (g.swiping && g.armed && event.type === "pointerup") onReply();
    setOffset(0);
  }

  const progress = Math.min(1, offset / SWIPE_TRIGGER_PX);

  return (
    <div
      className={`group flex items-center justify-start gap-1 ${isOwn ? "flex-row-reverse" : ""}`}
      style={{ touchAction: "pan-y" }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endGesture}
      onPointerCancel={endGesture}
    >
      {/* The bubble's max width lives here, so the reply button sits right
          next to it (row-reverse + justify-start = aligned right). */}
      <div
        className={`relative flex min-w-0 max-w-[80%] sm:max-w-[75%] ${offset === 0 ? "transition-transform duration-200" : ""}`}
        style={{ transform: offset ? `translateX(${offset}px)` : undefined }}
      >
        {offset > 0 && (
          <span
            aria-hidden
            className="pointer-events-none absolute right-full top-1/2 mr-2 rounded-full bg-neutral-200 p-1.5 text-neutral-600 dark:bg-night-raised dark:text-night-text"
            style={{ opacity: progress, transform: `translateY(-50%) scale(${0.6 + 0.4 * progress})` }}
          >
            <ReplyIcon className="h-4 w-4" />
          </span>
        )}
        {children}
      </div>
      {enabled && (
        <button
          type="button"
          onClick={onReply}
          aria-label="Antworten"
          title="Antworten"
          className="hidden flex-shrink-0 rounded-full p-1.5 text-neutral-400 opacity-0 transition-opacity hover:bg-neutral-100 hover:text-neutral-600 focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:hover)]:block dark:text-night-muted dark:hover:bg-night-raised dark:hover:text-night-text"
        >
          <ReplyIcon className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
