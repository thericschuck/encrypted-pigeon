"use client";

import type { TranslationEntry } from "@/app/translate/actions";

const LANGUAGE_SHORT: Record<string, string> = {
  DE: "DE",
  ZH: "中文",
  "ZH-HANS": "中文 (简)",
  "ZH-HANT": "中文 (繁)",
};

function formatWhen(iso: string) {
  const date = new Date(iso);
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  return sameDay
    ? date.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

interface TranslationHistoryProps {
  entries: TranslationEntry[];
  query: string;
  onQueryChange: (query: string) => void;
  loading: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
  onPick: (entry: TranslationEntry) => void;
  onDelete: (entry: TranslationEntry) => void;
}

/** Everything translated so far — search it before spending DeepL characters again. */
export function TranslationHistory({
  entries,
  query,
  onQueryChange,
  loading,
  hasMore,
  onLoadMore,
  onPick,
  onDelete,
}: TranslationHistoryProps) {
  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-neutral-200 p-4 dark:border-night-border dark:bg-night-surface">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Verlauf</h2>
        <span className="text-xs text-neutral-400 dark:text-night-muted">
          Gleicher Text nochmal = aus dem Verlauf, ohne Credits
        </span>
      </div>
      <input
        type="search"
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        placeholder="Im Verlauf suchen (Deutsch oder Chinesisch)…"
        aria-label="Im Verlauf suchen"
        className="w-full rounded-full border border-neutral-300 px-4 py-2 text-base sm:text-sm dark:border-night-border dark:bg-night-bg"
      />

      {entries.length === 0 ? (
        <p className="py-4 text-center text-sm text-neutral-400 dark:text-night-muted">
          {loading ? "Wird geladen…" : query.trim() ? "Nichts gefunden." : "Noch nichts übersetzt."}
        </p>
      ) : (
        <ul className={`flex flex-col divide-y divide-neutral-100 dark:divide-night-border ${loading ? "opacity-60" : ""}`}>
          {entries.map((entry) => (
            <li key={entry.id} className="group flex items-start gap-2 py-2">
              <button
                type="button"
                onClick={() => onPick(entry)}
                className="min-w-0 flex-1 rounded-lg px-2 py-1 text-left hover:bg-neutral-50 dark:hover:bg-night-raised"
              >
                <span className="mb-0.5 flex items-center gap-2 text-[11px] text-neutral-400 dark:text-night-muted">
                  <span className="font-medium">
                    {LANGUAGE_SHORT[entry.source_lang] ?? (entry.source_lang || "?")} →{" "}
                    {LANGUAGE_SHORT[entry.target_lang] ?? entry.target_lang}
                  </span>
                  <span>{formatWhen(entry.created_at)}</span>
                </span>
                <span className="line-clamp-2 block whitespace-pre-wrap break-words text-sm">{entry.source_text}</span>
                <span className="line-clamp-2 block whitespace-pre-wrap break-words text-sm text-neutral-500 dark:text-night-muted">
                  {entry.translated_text}
                </span>
              </button>
              <button
                type="button"
                onClick={() => onDelete(entry)}
                aria-label="Aus dem Verlauf löschen"
                title="Löschen"
                // Always visible on touch screens; on hover only with a mouse.
                className="mt-1 flex-shrink-0 rounded-full p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600 focus-visible:opacity-100 dark:text-night-muted dark:hover:bg-night-raised [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      )}

      {hasMore && (
        <button
          type="button"
          onClick={onLoadMore}
          disabled={loading}
          className="self-center rounded-full px-3 py-1 text-xs text-neutral-500 hover:bg-neutral-100 disabled:opacity-50 dark:text-night-muted dark:hover:bg-night-raised"
        >
          {loading ? "Wird geladen…" : "Mehr laden"}
        </button>
      )}
    </section>
  );
}
