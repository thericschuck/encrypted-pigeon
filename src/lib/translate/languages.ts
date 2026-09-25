/**
 * Languages the translator offers. Codes are DeepL's: source languages
 * have no script variant ("ZH"), target languages do ("ZH-HANS" =
 * simplified, as used in mainland China; "ZH-HANT" = traditional).
 */
export const SOURCE_LANGUAGES = [
  { code: "auto", label: "Automatisch erkennen" },
  { code: "DE", label: "Deutsch" },
  { code: "ZH", label: "Chinesisch" },
] as const;

export const TARGET_LANGUAGES = [
  { code: "ZH-HANS", label: "Chinesisch (vereinfacht)" },
  { code: "ZH-HANT", label: "Chinesisch (traditionell)" },
  { code: "DE", label: "Deutsch" },
] as const;

export type SourceLanguage = (typeof SOURCE_LANGUAGES)[number]["code"];
export type TargetLanguage = (typeof TARGET_LANGUAGES)[number]["code"];

/** Longest text per request — keeps a stray paste from eating the monthly quota. */
export const MAX_TRANSLATE_CHARS = 5000;

export function isSourceLanguage(value: string): value is SourceLanguage {
  return SOURCE_LANGUAGES.some((l) => l.code === value);
}

export function isTargetLanguage(value: string): value is TargetLanguage {
  return TARGET_LANGUAGES.some((l) => l.code === value);
}

/** The source language that matches a target (for the ⇄ swap button). */
export function sourceFor(target: TargetLanguage): SourceLanguage {
  return target === "DE" ? "DE" : "ZH";
}

/** The target language that matches a source (for the ⇄ swap button). */
export function targetFor(source: Exclude<SourceLanguage, "auto">): TargetLanguage {
  return source === "DE" ? "DE" : "ZH-HANS";
}
