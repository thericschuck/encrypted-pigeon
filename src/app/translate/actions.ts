"use server";

import { createClient } from "@/lib/supabase/server";
import { isAdminEmail } from "@/lib/auth/admin-email";
import type { Database } from "@/lib/supabase/types";
import { DeepLError, translate, usage, type Usage } from "@/lib/translate/deepl";
import { MAX_TRANSLATE_CHARS, isSourceLanguage, isTargetLanguage } from "@/lib/translate/languages";

export type TranslationEntry = Database["pigeon"]["Tables"]["translations"]["Row"];

export type TranslateResult =
  | {
      ok: true;
      entry: TranslationEntry;
      /** Answered from the history — no DeepL characters spent. */
      fromHistory: boolean;
      usage: Usage | null;
    }
  | { ok: false; error: string };

const HISTORY_PAGE_SIZE = 50;

// Re-checked in every action — the page hiding itself from non-admins
// doesn't stop anyone from calling an action directly. getUser(), not
// getClaims(): these spend quota, so a session revoked elsewhere must not
// count.
async function adminClient() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return isAdminEmail(user?.email) ? supabase : null;
}

export async function translateText(text: string, source: string, target: string): Promise<TranslateResult> {
  const supabase = await adminClient();
  if (!supabase) return { ok: false, error: "Nicht berechtigt." };

  const trimmed = text.trim();
  if (!trimmed) return { ok: false, error: "Bitte einen Text eingeben." };
  if (trimmed.length > MAX_TRANSLATE_CHARS) {
    return { ok: false, error: `Maximal ${MAX_TRANSLATE_CHARS.toLocaleString("de-DE")} Zeichen auf einmal.` };
  }
  if (!isSourceLanguage(source) || !isTargetLanguage(target)) {
    return { ok: false, error: "Unbekannte Sprache." };
  }

  // Translated this exact text into this language before? Then that's the
  // answer — moved back to the top of the history, no DeepL call.
  const { data: known } = await supabase
    .from("translations")
    .select("*")
    .eq("target_lang", target)
    .eq("source_text", trimmed)
    .maybeSingle();
  if (known) {
    const { data: bumped } = await supabase
      .from("translations")
      .update({ created_at: new Date().toISOString() })
      .eq("id", known.id)
      .select("*")
      .single();
    return { ok: true, entry: bumped ?? known, fromHistory: true, usage: null };
  }

  let result;
  try {
    result = await translate(trimmed, source, target);
  } catch (error) {
    if (error instanceof DeepLError) return { ok: false, error: error.message };
    console.error("Translation failed:", error);
    return { ok: false, error: "Übersetzung fehlgeschlagen." };
  }

  const row = {
    source_lang: result.detectedSource || (source === "auto" ? "" : source),
    target_lang: target,
    source_text: trimmed,
    translated_text: result.text,
  };
  const { data: saved, error: saveError } = await supabase.from("translations").insert(row).select("*").single();
  // Not saving to the history must not cost the translation itself.
  if (saveError) console.error("Saving translation failed:", saveError.message);
  const entry: TranslationEntry = saved ?? {
    ...row,
    id: crypto.randomUUID(),
    user_id: "",
    created_at: new Date().toISOString(),
  };
  return { ok: true, entry, fromHistory: false, usage: await usage() };
}

export type HistoryPage = { entries: TranslationEntry[]; hasMore: boolean };

/** Newest first; `query` searches original and translation, `before` pages on. */
export async function loadHistory(query = "", before: string | null = null): Promise<HistoryPage> {
  const supabase = await adminClient();
  if (!supabase) return { entries: [], hasMore: false };
  const { data, error } = await supabase.rpc("search_translations", {
    p_query: query.trim() || null,
    p_before: before,
    p_limit: HISTORY_PAGE_SIZE + 1,
  });
  if (error) {
    console.error("Loading translation history failed:", error.message);
    return { entries: [], hasMore: false };
  }
  const rows = data ?? [];
  return { entries: rows.slice(0, HISTORY_PAGE_SIZE), hasMore: rows.length > HISTORY_PAGE_SIZE };
}

export async function deleteTranslation(id: string): Promise<boolean> {
  const supabase = await adminClient();
  if (!supabase) return false;
  const { error } = await supabase.from("translations").delete().eq("id", id);
  return !error;
}
