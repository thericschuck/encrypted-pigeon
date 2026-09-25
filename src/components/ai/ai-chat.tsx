"use client";

import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { createClient } from "@/lib/supabase/client";
import type { AiMode } from "@/lib/ai/deepseek";
import { AI_MAX_QUESTION_CHARS, type AiStreamEvent } from "@/lib/ai/protocol";
import type { AiRole } from "@/lib/supabase/types";

interface ConversationSummary {
  id: string;
  title: string;
  updated_at: string;
}

interface UiMessage {
  id: string;
  role: AiRole;
  content: string;
  reasoning: string | null;
  model?: string | null;
  /** Still streaming in. */
  pending?: boolean;
  error?: string;
}

interface AiChatProps {
  configured: boolean;
  initialConversations: ConversationSummary[];
  initialConversationId: string | null;
  initialMessages: UiMessage[];
}

const MODE_KEY = "pigeon-ai-mode";
const SUGGESTIONS = [
  "Wie sage ich „Wo ist die nächste Apotheke?“ auf Chinesisch (mit Pinyin)?",
  "Wie spät ist es gerade in Deutschland?",
  "Wann habe ich heute laut Plan frei?",
  "Was hilft gegen Muskelkater nach hartem Training?",
];

function readMode(): AiMode {
  try {
    return localStorage.getItem(MODE_KEY) === "deep" ? "deep" : "fast";
  } catch {
    return "fast";
  }
}

function Markdown({ text }: { text: string }) {
  return (
    <div className="prose prose-sm max-w-none break-words dark:prose-invert prose-pre:overflow-x-auto prose-table:block prose-table:overflow-x-auto">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // Clipboard blocked — nothing to do.
        }
      }}
      className="text-[11px] text-neutral-400 hover:text-neutral-600 dark:text-night-muted dark:hover:text-night-text"
    >
      {copied ? "Kopiert ✓" : "Kopieren"}
    </button>
  );
}

/**
 * The KI-Assistent: DeepSeek via /api/ai/chat, answers streamed in as
 * they're written. Conversations are stored (RLS: mine only) and listed
 * on the left (a panel on phones).
 */
export function AiChat({ configured, initialConversations, initialConversationId, initialMessages }: AiChatProps) {
  const [conversations, setConversations] = useState(initialConversations);
  const [activeId, setActiveId] = useState(initialConversationId);
  const [messages, setMessages] = useState<UiMessage[]>(initialMessages);
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<AiMode>("fast");
  const [streaming, setStreaming] = useState(false);
  const [loadingConversation, setLoadingConversation] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => setMode(readMode()), []);

  // Follow the answer while it streams, unless the user scrolled up to read.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  // Grow the textarea with its content (up to max-h).
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [input]);

  function changeMode(next: AiMode) {
    setMode(next);
    try {
      localStorage.setItem(MODE_KEY, next);
    } catch {
      // Not persisted — fine.
    }
  }

  function showUrl(id: string | null) {
    window.history.replaceState(null, "", id ? `/ai?c=${id}` : "/ai");
  }

  function newConversation() {
    abortRef.current?.abort();
    setActiveId(null);
    setMessages([]);
    setError(null);
    setHistoryOpen(false);
    showUrl(null);
    textareaRef.current?.focus();
  }

  async function openConversation(id: string) {
    setHistoryOpen(false);
    if (id === activeId) return;
    abortRef.current?.abort();
    setLoadingConversation(true);
    setError(null);
    const { data, error: loadError } = await createClient()
      .from("ai_messages")
      .select("id, role, content, reasoning, model")
      .eq("conversation_id", id)
      .order("created_at", { ascending: true });
    setLoadingConversation(false);
    if (loadError) {
      setError(`Unterhaltung konnte nicht geladen werden: ${loadError.message}`);
      return;
    }
    stickToBottomRef.current = true;
    setActiveId(id);
    setMessages(data ?? []);
    showUrl(id);
  }

  async function deleteConversation(id: string) {
    if (!window.confirm("Diese Unterhaltung löschen?")) return;
    const { error: deleteError } = await createClient().from("ai_conversations").delete().eq("id", id);
    if (deleteError) {
      setError(`Löschen fehlgeschlagen: ${deleteError.message}`);
      return;
    }
    setConversations((all) => all.filter((c) => c.id !== id));
    if (id === activeId) newConversation();
  }

  async function ask(question: string) {
    const trimmed = question.trim();
    if (!trimmed || streaming) return;
    setError(null);
    setInput("");
    stickToBottomRef.current = true;
    const pendingId = `pending-${Date.now()}`;
    setMessages((all) => [
      ...all,
      { id: `q-${Date.now()}`, role: "user", content: trimmed, reasoning: null },
      { id: pendingId, role: "assistant", content: "", reasoning: null, pending: true },
    ]);
    const update = (patch: (m: UiMessage) => UiMessage) =>
      setMessages((all) => all.map((m) => (m.id === pendingId ? patch(m) : m)));

    const controller = new AbortController();
    abortRef.current = controller;
    setStreaming(true);
    let conversationId = activeId;
    try {
      const response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: activeId, message: trimmed, mode }),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error ?? `Fehler ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let newline: number;
        while ((newline = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          if (!line.trim()) continue;
          const event = JSON.parse(line) as AiStreamEvent;
          if (event.type === "meta") {
            update((m) => ({ ...m, model: event.model }));
            if (!conversationId) {
              conversationId = event.conversationId;
              setActiveId(event.conversationId);
              showUrl(event.conversationId);
            }
          } else if (event.type === "content") {
            update((m) => ({ ...m, content: m.content + event.text }));
          } else if (event.type === "reasoning") {
            update((m) => ({ ...m, reasoning: (m.reasoning ?? "") + event.text }));
          } else if (event.type === "done") {
            update((m) => ({ ...m, id: event.messageId, pending: false }));
          } else if (event.type === "error") {
            update((m) => ({ ...m, pending: false, error: event.message }));
          }
        }
      }
    } catch (e) {
      if (controller.signal.aborted) {
        update((m) => ({ ...m, pending: false, error: m.content ? undefined : "Abgebrochen." }));
      } else {
        update((m) => ({ ...m, pending: false, error: e instanceof Error ? e.message : String(e) }));
      }
    } finally {
      update((m) => ({ ...m, pending: false }));
      setStreaming(false);
      abortRef.current = null;
      // Newest conversation first (a new one appears, an old one moves up).
      if (conversationId) {
        const id = conversationId;
        setConversations((all) => {
          const existing = all.find((c) => c.id === id);
          const title = existing?.title ?? (trimmed.length > 60 ? `${trimmed.slice(0, 57)}…` : trimmed);
          return [{ id, title, updated_at: new Date().toISOString() }, ...all.filter((c) => c.id !== id)];
        });
      }
    }
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    void ask(input);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends on devices with a keyboard; on phones Enter is a new line
    // and the button sends.
    if (event.key === "Enter" && !event.shiftKey && window.matchMedia("(pointer: fine)").matches) {
      event.preventDefault();
      void ask(input);
    }
  }

  const history = (
    <nav className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-2">
      <button
        type="button"
        onClick={newConversation}
        className="mb-1 rounded-xl border border-neutral-200 px-3 py-2 text-left text-sm font-medium hover:bg-neutral-50 dark:border-night-border dark:hover:bg-night-raised"
      >
        + Neue Unterhaltung
      </button>
      {conversations.length === 0 && (
        <p className="px-3 py-2 text-xs text-neutral-400 dark:text-night-muted">Noch keine Unterhaltungen.</p>
      )}
      {conversations.map((c) => (
        <div
          key={c.id}
          className={`group flex items-center gap-1 rounded-xl ${
            c.id === activeId ? "bg-neutral-100 dark:bg-night-raised" : "hover:bg-neutral-50 dark:hover:bg-night-surface"
          }`}
        >
          <button
            type="button"
            onClick={() => void openConversation(c.id)}
            className="min-w-0 flex-1 truncate px-3 py-2 text-left text-sm"
          >
            {c.title}
          </button>
          <button
            type="button"
            onClick={() => void deleteConversation(c.id)}
            aria-label="Unterhaltung löschen"
            className="flex-shrink-0 rounded-full p-1.5 text-neutral-400 opacity-100 hover:text-red-600 md:opacity-0 md:group-hover:opacity-100 dark:text-night-muted"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-3.5 w-3.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      ))}
    </nav>
  );

  return (
    <div className="flex min-h-0 flex-1">
      <aside className="hidden w-72 flex-shrink-0 flex-col border-r border-neutral-200 pt-[env(safe-area-inset-top)] md:flex dark:border-night-border">
        <div className="px-4 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-neutral-400 dark:text-night-muted">
          Verlauf
        </div>
        {history}
      </aside>

      {historyOpen && (
        <div className="fixed inset-0 z-40 flex md:hidden">
          <div className="flex w-[85%] max-w-xs flex-col bg-white pt-[env(safe-area-inset-top)] shadow-xl dark:bg-night-bg">
            <div className="px-4 pb-1 pt-4 text-xs font-semibold uppercase tracking-wide text-neutral-400 dark:text-night-muted">
              Verlauf
            </div>
            {history}
          </div>
          <button type="button" aria-label="Verlauf schließen" onClick={() => setHistoryOpen(false)} className="flex-1 bg-black/30" />
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-2 border-b border-neutral-200 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] dark:border-night-border">
          <Link
            href="/"
            aria-label="Zurück"
            className="flex-shrink-0 text-neutral-400 hover:text-neutral-600 dark:text-night-muted dark:hover:text-night-text"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <h1 className="min-w-0 flex-1 truncate text-sm font-semibold">🦉 KI-Assistent</h1>
          <button
            type="button"
            onClick={() => setHistoryOpen(true)}
            className="rounded-full px-3 py-1 text-xs text-neutral-500 hover:bg-neutral-100 md:hidden dark:text-night-muted dark:hover:bg-night-raised"
          >
            Verlauf
          </button>
          <button
            type="button"
            onClick={newConversation}
            aria-label="Neue Unterhaltung"
            title="Neue Unterhaltung"
            className="rounded-full p-1.5 text-neutral-500 hover:bg-neutral-100 dark:text-night-muted dark:hover:bg-night-raised"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14M5 12h14" />
            </svg>
          </button>
        </header>

        <div
          ref={scrollRef}
          onScroll={(e) => {
            const el = e.currentTarget;
            stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          }}
          className="min-h-0 flex-1 overflow-y-auto"
        >
          <div className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-4">
            {!configured && (
              <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-200">
                Es ist noch kein DeepSeek-API-Key hinterlegt. Trag <code>DEEPSEEK_API_KEY</code> in die Umgebungsvariablen
                ein (lokal <code>.env.local</code>, beim Hosting in den Projekt-Einstellungen) und starte die App neu.
              </div>
            )}

            {loadingConversation && <p className="text-center text-xs text-neutral-400">Lädt…</p>}

            {messages.length === 0 && !loadingConversation && (
              <div className="flex flex-col items-center gap-4 pt-10 text-center">
                <span className="text-4xl">🦉</span>
                <div>
                  <p className="font-semibold">Frag mich etwas</p>
                  <p className="text-xs text-neutral-500 dark:text-night-muted">
                    DeepSeek, funktioniert auch in China ohne VPN. Ich kenne deine Uhrzeit und deinen Wochenplan, aber
                    kein Internet.
                  </p>
                </div>
                <div className="flex w-full flex-col gap-2">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      disabled={!configured}
                      onClick={() => void ask(s)}
                      className="rounded-xl border border-neutral-200 px-3 py-2 text-left text-sm hover:bg-neutral-50 disabled:opacity-50 dark:border-night-border dark:hover:bg-night-surface"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m) =>
              m.role === "user" ? (
                <div key={m.id} className="flex justify-end">
                  <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-bubble px-3 py-2 text-sm text-white">
                    {m.content}
                  </div>
                </div>
              ) : (
                <div key={m.id} className="flex flex-col gap-1.5">
                  {m.reasoning && (
                    <details className="rounded-xl bg-neutral-50 px-3 py-2 text-xs text-neutral-500 dark:bg-night-surface dark:text-night-muted" open={m.pending && !m.content}>
                      <summary className="cursor-pointer select-none">
                        🧠 {m.pending && !m.content ? "Denkt nach…" : "Gedankengang"}
                      </summary>
                      <p className="mt-2 whitespace-pre-wrap">{m.reasoning}</p>
                    </details>
                  )}
                  {m.content ? (
                    <Markdown text={m.content} />
                  ) : (
                    m.pending &&
                    !m.reasoning && (
                      <p className="animate-pulse text-sm text-neutral-400 dark:text-night-muted">Schreibt…</p>
                    )
                  )}
                  {m.error && (
                    <p className="rounded-xl border border-red-200 bg-red-50 p-2 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
                      {m.error}
                    </p>
                  )}
                  {!m.pending && m.content && (
                    <div className="flex items-center gap-3">
                      <CopyButton text={m.content} />
                      {m.model && <span className="text-[10px] text-neutral-300 dark:text-night-border">{m.model}</span>}
                    </div>
                  )}
                </div>
              )
            )}
          </div>
        </div>

        <div className="border-t border-neutral-200 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] dark:border-night-border">
          <div className="mx-auto flex max-w-3xl flex-col gap-2">
            {error && (
              <div className="flex items-start justify-between gap-2 rounded-xl border border-red-200 bg-red-50 p-2 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
                <span>{error}</span>
                <button type="button" onClick={() => setError(null)} aria-label="Hinweis schließen">
                  ✕
                </button>
              </div>
            )}
            <div className="flex items-center gap-2">
              <div className="flex rounded-full bg-neutral-100 p-0.5 text-xs dark:bg-night-raised">
                {(
                  [
                    { value: "fast", label: "⚡ Schnell" },
                    { value: "deep", label: "🧠 Gründlich" },
                  ] as const
                ).map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => changeMode(option.value)}
                    aria-pressed={mode === option.value}
                    className={`rounded-full px-3 py-1 ${
                      mode === option.value ? "bg-white font-medium shadow-sm dark:bg-night-surface" : "text-neutral-500 dark:text-night-muted"
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              {mode === "deep" && (
                <span className="truncate text-[11px] text-neutral-400 dark:text-night-muted">denkt länger, für knifflige Fragen</span>
              )}
            </div>
            <form onSubmit={handleSubmit} className="flex items-end gap-2">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                rows={1}
                maxLength={AI_MAX_QUESTION_CHARS}
                disabled={!configured}
                placeholder="Frag den Assistenten…"
                className="max-h-40 min-h-[2.5rem] flex-1 resize-none rounded-2xl border border-neutral-300 px-3 py-2 text-base focus:border-accent focus:outline-none disabled:opacity-50 sm:text-sm dark:border-night-border dark:bg-night-surface"
              />
              {streaming ? (
                <button
                  type="button"
                  onClick={() => abortRef.current?.abort()}
                  className="flex-shrink-0 rounded-full border border-neutral-300 px-4 py-2 text-sm font-medium dark:border-night-border"
                >
                  Stopp
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={!configured || !input.trim()}
                  className="flex-shrink-0 rounded-full bg-accent px-4 py-2 text-sm font-medium text-on-accent disabled:opacity-50"
                >
                  Senden
                </button>
              )}
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
