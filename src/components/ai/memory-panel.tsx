"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { AI_MAX_INSTRUCTIONS_CHARS, AI_MAX_MEMORY_CHARS } from "@/lib/ai/protocol";

export interface AiMemory {
  id: string;
  content: string;
}

const INPUT =
  "w-full rounded-xl border border-neutral-300 px-3 py-2 text-base focus:border-accent focus:outline-none sm:text-sm dark:border-night-border dark:bg-night-surface";

const INSTRUCTIONS_PLACEHOLDER = `z.B.
- Antworte kurz und direkt.
- Chinesisch immer mit Schriftzeichen und Pinyin.
- Preise in ¥ und ungefähr in €.`;

interface MemoryPanelProps {
  userId: string;
  instructions: string;
  memories: AiMemory[];
  onInstructionsSaved: (instructions: string) => void;
  onMemoriesChange: (memories: AiMemory[]) => void;
  onClose: () => void;
}

/**
 * "Gedächtnis & Anweisungen": what the assistant knows about me and how it
 * should answer. Both go into every system prompt (lib/ai/context.ts).
 */
export function MemoryPanel({
  userId,
  instructions,
  memories,
  onInstructionsSaved,
  onMemoriesChange,
  onClose,
}: MemoryPanelProps) {
  const [draftInstructions, setDraftInstructions] = useState(instructions);
  const [newMemory, setNewMemory] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function run(action: () => PromiseLike<{ error: { message: string } | null }>) {
    setBusy(true);
    setError(null);
    const { error: failure } = await action();
    setBusy(false);
    if (failure) setError(`Speichern fehlgeschlagen: ${failure.message}`);
    return !failure;
  }

  async function saveInstructions() {
    const value = draftInstructions.trim();
    const ok = await run(() =>
      createClient()
        .from("ai_settings")
        .upsert({ owner_id: userId, instructions: value, updated_at: new Date().toISOString() })
    );
    if (ok) {
      onInstructionsSaved(value);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    }
  }

  async function addMemory() {
    const content = newMemory.trim();
    if (!content) return;
    let created: AiMemory | null = null;
    const ok = await run(async () => {
      const { data, error: insertError } = await createClient()
        .from("ai_memories")
        .insert({ owner_id: userId, content })
        .select("id, content")
        .single();
      created = data;
      return { error: insertError };
    });
    if (ok && created) {
      onMemoriesChange([...memories, created]);
      setNewMemory("");
    }
  }

  async function updateMemory(memory: AiMemory, content: string) {
    const value = content.trim();
    if (value === memory.content) return;
    if (!value) {
      await deleteMemory(memory);
      return;
    }
    const ok = await run(() => createClient().from("ai_memories").update({ content: value }).eq("id", memory.id));
    if (ok) onMemoriesChange(memories.map((m) => (m.id === memory.id ? { ...m, content: value } : m)));
  }

  async function deleteMemory(memory: AiMemory) {
    const ok = await run(() => createClient().from("ai_memories").delete().eq("id", memory.id));
    if (ok) onMemoriesChange(memories.filter((m) => m.id !== memory.id));
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <div
        className="flex h-full w-full max-w-md flex-col gap-5 overflow-y-auto bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))] shadow-xl dark:bg-night-bg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">🧠 Gedächtnis & Anweisungen</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Schließen"
            className="rounded-full p-1.5 text-neutral-500 hover:bg-neutral-100 dark:text-night-muted dark:hover:bg-night-raised"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {error && (
          <p className="rounded-xl border border-red-200 bg-red-50 p-2 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </p>
        )}

        <section className="flex flex-col gap-2">
          <div>
            <h3 className="text-sm font-semibold">Gedächtnis</h3>
            <p className="text-xs text-neutral-500 dark:text-night-muted">
              Fakten über dich, die der Assistent immer kennt, z.B. wo du bist, was du machst, was du magst oder
              verträgst.
            </p>
          </div>
          {memories.length === 0 && (
            <p className="text-xs italic text-neutral-400 dark:text-night-muted">Noch nichts gespeichert.</p>
          )}
          <ul className="flex flex-col gap-1.5">
            {memories.map((memory) => (
              <li key={memory.id} className="flex items-start gap-1.5">
                <textarea
                  defaultValue={memory.content}
                  onBlur={(e) => void updateMemory(memory, e.target.value)}
                  maxLength={AI_MAX_MEMORY_CHARS}
                  rows={Math.min(4, Math.ceil(memory.content.length / 45) || 1)}
                  className={`${INPUT} resize-none`}
                />
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void deleteMemory(memory)}
                  aria-label="Eintrag löschen"
                  className="mt-1.5 flex-shrink-0 rounded-full p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-red-600 dark:text-night-muted dark:hover:bg-night-raised"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                  </svg>
                </button>
              </li>
            ))}
          </ul>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void addMemory();
            }}
            className="flex gap-1.5"
          >
            <input
              value={newMemory}
              onChange={(e) => setNewMemory(e.target.value)}
              maxLength={AI_MAX_MEMORY_CHARS}
              placeholder="z.B. Ich lebe gerade in Dengfeng und trainiere Kung Fu."
              className={INPUT}
            />
            <button
              type="submit"
              disabled={busy || !newMemory.trim()}
              className="flex-shrink-0 rounded-full bg-accent px-4 py-2 text-sm font-medium text-on-accent disabled:opacity-50"
            >
              +
            </button>
          </form>
        </section>

        <section className="flex flex-col gap-2">
          <div>
            <h3 className="text-sm font-semibold">Anweisungen</h3>
            <p className="text-xs text-neutral-500 dark:text-night-muted">Wie der Assistent antworten soll.</p>
          </div>
          <textarea
            value={draftInstructions}
            onChange={(e) => setDraftInstructions(e.target.value)}
            maxLength={AI_MAX_INSTRUCTIONS_CHARS}
            rows={6}
            placeholder={INSTRUCTIONS_PLACEHOLDER}
            className={INPUT}
          />
          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled={busy || draftInstructions.trim() === instructions}
              onClick={() => void saveInstructions()}
              className="rounded-full bg-accent px-4 py-1.5 text-sm font-medium text-on-accent disabled:opacity-50"
            >
              Speichern
            </button>
            {saved && <span className="text-xs text-neutral-500 dark:text-night-muted">Gespeichert ✓</span>}
          </div>
        </section>
      </div>
    </div>
  );
}
