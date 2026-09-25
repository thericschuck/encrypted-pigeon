"use server";

import { createClient } from "@/lib/supabase/server";
import { isAdminEmail } from "@/lib/auth/admin-email";
import { DeepLError, translate, usage, type Usage } from "@/lib/translate/deepl";
import { MAX_TRANSLATE_CHARS, isSourceLanguage, isTargetLanguage } from "@/lib/translate/languages";

export type TranslateResult =
  | { ok: true; text: string; detectedSource: string; usage: Usage | null }
  | { ok: false; error: string };

export async function translateText(text: string, source: string, target: string): Promise<TranslateResult> {
  // Re-checked here — the page hiding itself from non-admins doesn't stop
  // anyone from calling the action directly. getUser(), not getClaims():
  // this spends quota, so a session revoked elsewhere must not count.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isAdminEmail(user?.email)) return { ok: false, error: "Nicht berechtigt." };

  const trimmed = text.trim();
  if (!trimmed) return { ok: false, error: "Bitte einen Text eingeben." };
  if (trimmed.length > MAX_TRANSLATE_CHARS) {
    return { ok: false, error: `Maximal ${MAX_TRANSLATE_CHARS.toLocaleString("de-DE")} Zeichen auf einmal.` };
  }
  if (!isSourceLanguage(source) || !isTargetLanguage(target)) {
    return { ok: false, error: "Unbekannte Sprache." };
  }

  try {
    const result = await translate(trimmed, source, target);
    return { ok: true, ...result, usage: await usage() };
  } catch (error) {
    if (error instanceof DeepLError) return { ok: false, error: error.message };
    console.error("Translation failed:", error);
    return { ok: false, error: "Übersetzung fehlgeschlagen." };
  }
}
