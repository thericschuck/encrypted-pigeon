"use client";

import { useEffect, useRef, useState, useTransition, type FormEvent, type KeyboardEvent } from "react";
import {
  deleteTranslation,
  loadHistory,
  translateText,
  type HistoryPage,
  type TranslationEntry,
} from "@/app/translate/actions";
import { TranslationHistory } from "@/components/translate/translation-history";
import type { Usage } from "@/lib/translate/deepl";
import {
  MAX_TRANSLATE_CHARS,
  SOURCE_LANGUAGES,
  TARGET_LANGUAGES,
  isSourceLanguage,
  isTargetLanguage,
  sourceFor,
  targetFor,
  type SourceLanguage,
  type TargetLanguage,
} from "@/lib/translate/languages";

const SELECT_CLASS =
  "min-w-0 flex-1 rounded-xl border border-neutral-300 bg-transparent px-3 py-2 text-base sm:text-sm dark:border-night-border dark:bg-night-surface";

// Searching waits for a short typing pause instead of querying per key.
const HISTORY_SEARCH_DEBOUNCE_MS = 250;

export function Translator({
  initialUsage,
  initialHistory,
}: {
  initialUsage: Usage | null;
  initialHistory: HistoryPage;
}) {
  const [source, setSource] = useState<SourceLanguage>("DE");
  const [target, setTarget] = useState<TargetLanguage>("ZH-HANS");
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  // DeepL's answer to "Automatisch erkennen", shown under the input.
  const [detected, setDetected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [usage, setUsage] = useState(initialUsage);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();
  // The shown translation came from the history (no DeepL characters spent).
  const [fromHistory, setFromHistory] = useState(false);
  const [history, setHistory] = useState(initialHistory.entries);
  const [historyHasMore, setHistoryHasMore] = useState(initialHistory.hasMore);
  const [historyQuery, setHistoryQuery] = useState("");
  const [historyLoading, setHistoryLoading] = useState(false);
  // Only the newest search/page request may write its result.
  const historyRequestRef = useRef(0);
  const searchedOnceRef = useRef(false);

  const tooLong = input.length > MAX_TRANSLATE_CHARS;
  const canTranslate = !!input.trim() && !tooLong && !pending;

  function runTranslation() {
    if (!canTranslate) return;
    setError(null);
    startTransition(async () => {
      const result = await translateText(input, source, target);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const { entry } = result;
      setOutput(entry.translated_text);
      setDetected(source === "auto" ? entry.source_lang : null);
      setFromHistory(result.fromHistory);
      setCopied(false);
      if (result.usage) setUsage(result.usage);
      // Newest on top — also for a history hit, which moved up there.
      if (!historyQuery.trim()) setHistory((prev) => [entry, ...prev.filter((e) => e.id !== entry.id)]);
    });
  }

  useEffect(() => {
    // The first render already has the unfiltered history from the server.
    if (!searchedOnceRef.current && !historyQuery) return;
    searchedOnceRef.current = true;
    const request = ++historyRequestRef.current;
    setHistoryLoading(true);
    const timer = setTimeout(async () => {
      const page = await loadHistory(historyQuery);
      if (request !== historyRequestRef.current) return;
      setHistory(page.entries);
      setHistoryHasMore(page.hasMore);
      setHistoryLoading(false);
    }, HISTORY_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [historyQuery]);

  async function loadMoreHistory() {
    const last = history[history.length - 1];
    if (!last) return;
    const request = ++historyRequestRef.current;
    setHistoryLoading(true);
    const page = await loadHistory(historyQuery, last.created_at);
    if (request !== historyRequestRef.current) return;
    setHistory((prev) => [...prev, ...page.entries.filter((e) => !prev.some((p) => p.id === e.id))]);
    setHistoryHasMore(page.hasMore);
    setHistoryLoading(false);
  }

  // Back into the translator, as if just translated — for copying, or to
  // go on from there.
  function pickFromHistory(entry: TranslationEntry) {
    setInput(entry.source_text);
    setOutput(entry.translated_text);
    if (isTargetLanguage(entry.target_lang)) setTarget(entry.target_lang);
    setSource(isSourceLanguage(entry.source_lang) ? entry.source_lang : "auto");
    setDetected(null);
    setFromHistory(true);
    setError(null);
    setCopied(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function removeFromHistory(entry: TranslationEntry) {
    setHistory((prev) => prev.filter((e) => e.id !== entry.id));
    if (!(await deleteTranslation(entry.id))) {
      setHistory((prev) =>
        [entry, ...prev].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
      );
      setError("Eintrag konnte nicht gelöscht werden.");
    }
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    runTranslation();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      runTranslation();
    }
  }

  // ⇄ like on DeepL: languages switch sides and the translation becomes
  // the new input.
  function swap() {
    const resolvedSource = source === "auto" ? (detected === "DE" ? "DE" : detected ? "ZH" : null) : source;
    setSource(sourceFor(target));
    setTarget(targetFor(resolvedSource ?? (target === "DE" ? "ZH" : "DE")));
    if (output) {
      setInput(output);
      setOutput("");
    }
    setDetected(null);
    setError(null);
  }

  async function copyOutput() {
    try {
      await navigator.clipboard.writeText(output);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("Kopieren hat nicht geklappt — bitte Text markieren und manuell kopieren.");
    }
  }

  const detectedLabel = detected ? (SOURCE_LANGUAGES.find((l) => l.code === detected)?.label ?? detected) : null;

  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <select
            value={source}
            onChange={(event) => isSourceLanguage(event.target.value) && setSource(event.target.value)}
            aria-label="Ausgangssprache"
            className={SELECT_CLASS}
          >
            {SOURCE_LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={swap}
            aria-label="Sprachen tauschen"
            title="Sprachen tauschen"
            className="flex-shrink-0 rounded-full p-2 text-neutral-500 hover:bg-neutral-100 dark:text-night-muted dark:hover:bg-night-raised"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M7 16V4m0 0L3 8m4-4 4 4M17 8v12m0 0 4-4m-4 4-4-4" />
            </svg>
          </button>
          <select
            value={target}
            onChange={(event) => isTargetLanguage(event.target.value) && setTarget(event.target.value)}
            aria-label="Zielsprache"
            className={SELECT_CLASS}
          >
            {TARGET_LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </select>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <textarea
              value={input}
              onChange={(event) => {
                setInput(event.target.value);
                setFromHistory(false);
              }}
              onKeyDown={handleKeyDown}
              rows={8}
              autoFocus
              aria-label="Text zum Übersetzen"
              placeholder="Text eingeben…"
              className="min-h-40 w-full resize-y rounded-2xl border border-neutral-300 px-4 py-3 text-base leading-6 sm:text-sm sm:leading-6 dark:border-night-border"
            />
            <div className="flex items-center justify-between gap-2 px-1 text-xs text-neutral-400 dark:text-night-muted">
              <span>{detectedLabel ? `Erkannt: ${detectedLabel}` : "Strg/⌘ + Enter übersetzt"}</span>
              <span className={`tabular-nums ${tooLong ? "font-medium text-red-500" : ""}`}>
                {input.length.toLocaleString("de-DE")} / {MAX_TRANSLATE_CHARS.toLocaleString("de-DE")}
              </span>
            </div>
          </div>

          <div className="relative flex min-h-40 flex-col rounded-2xl border border-neutral-200 bg-neutral-50 dark:border-night-border dark:bg-night-surface">
            <div
              aria-live="polite"
              className={`flex-1 whitespace-pre-wrap break-words px-4 py-3 text-base leading-7 sm:text-sm sm:leading-6 ${
                pending ? "opacity-50" : ""
              } ${output ? "" : "text-neutral-400 dark:text-night-muted"}`}
            >
              {output || (pending ? "Wird übersetzt…" : "Übersetzung")}
            </div>
            {output && (
              <div className="flex items-center justify-between gap-2 px-2 pb-2">
                <span className="px-2 text-[11px] text-neutral-400 dark:text-night-muted">
                  {fromHistory ? "Aus dem Verlauf – keine Credits verbraucht" : ""}
                </span>
                <button
                  type="button"
                  onClick={copyOutput}
                  className="rounded-full px-3 py-1 text-xs text-neutral-500 hover:bg-neutral-200 dark:text-night-muted dark:hover:bg-night-raised"
                >
                  {copied ? "✓ Kopiert" : "Kopieren"}
                </button>
              </div>
            )}
          </div>
        </div>

        {error && (
          <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-2 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </p>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-xs text-neutral-400 dark:text-night-muted">
            {usage
              ? `DeepL: ${usage.used.toLocaleString("de-DE")} von ${usage.limit.toLocaleString("de-DE")} Zeichen diesen Monat`
              : "Übersetzt mit DeepL"}
          </span>
          <button
            type="submit"
            disabled={!canTranslate}
            className="rounded-full bg-accent px-5 py-2 text-sm text-on-accent disabled:opacity-50"
          >
            {pending ? "Wird übersetzt…" : "Übersetzen"}
          </button>
        </div>
      </form>
      <TranslationHistory
        entries={history}
        query={historyQuery}
        onQueryChange={setHistoryQuery}
        loading={historyLoading}
        hasMore={historyHasMore}
        onLoadMore={() => void loadMoreHistory()}
        onPick={pickFromHistory}
        onDelete={(entry) => void removeFromHistory(entry)}
      />
    </div>
  );
}
