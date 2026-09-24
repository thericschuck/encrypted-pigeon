"use client";

/** Line above the first message that was new when the chat was opened. */
export function UnreadDivider() {
  return (
    <div className="animate-fade-in flex items-center gap-3 py-2" role="separator" aria-label="Neue Nachrichten">
      <span className="h-px flex-1 bg-[#c1643a]/40 dark:bg-night-accent/40" />
      <span className="text-[11px] font-semibold uppercase tracking-wide text-[#b0532b] dark:text-night-accent">
        Neue Nachrichten
      </span>
      <span className="h-px flex-1 bg-[#c1643a]/40 dark:bg-night-accent/40" />
    </div>
  );
}

interface NewMessagesButtonProps {
  count: number;
  onClick: () => void;
}

/** Floats above the composer while new messages arrived below the scrolled-up view. */
export function NewMessagesButton({ count, onClick }: NewMessagesButtonProps) {
  if (count === 0) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
      <button
        type="button"
        onClick={onClick}
        className="animate-message-in pointer-events-auto flex items-center gap-1.5 rounded-full bg-[#c1643a] px-3.5 py-1.5 text-xs font-medium text-white shadow-md hover:bg-[#b0532b] dark:bg-night-accent dark:text-night-bg"
      >
        {count === 1 ? "1 neue Nachricht" : `${count > 99 ? "99+" : count} neue Nachrichten`}
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="h-3.5 w-3.5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
    </div>
  );
}
