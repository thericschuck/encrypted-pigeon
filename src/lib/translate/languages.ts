import type { Locale } from "@/lib/i18n/config";

/**
 * Languages the translator offers. Codes are DeepL's: source languages
 * have no regional/script variant ("EN", "ZH"), target languages do
 * ("EN-GB", "ZH-HANS" = simplified, "ZH-HANT" = traditional). Labels are
 * message keys (resolved with t() in the UI language), not text.
 */
export const SOURCE_LANGUAGES = [
  { code: "auto", labelKey: "translate.lang.auto" },
  { code: "DE", labelKey: "translate.lang.de" },
  { code: "EN", labelKey: "translate.lang.en" },
  { code: "FR", labelKey: "translate.lang.fr" },
  { code: "ZH", labelKey: "translate.lang.zh" },
] as const;

export const TARGET_LANGUAGES = [
  { code: "DE", labelKey: "translate.lang.de" },
  { code: "EN-GB", labelKey: "translate.lang.en" },
  { code: "FR", labelKey: "translate.lang.fr" },
  { code: "ZH-HANS", labelKey: "translate.lang.zhHans" },
  { code: "ZH-HANT", labelKey: "translate.lang.zhHant" },
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
export function sourceFor(target: TargetLanguage): Exclude<SourceLanguage, "auto"> {
  return target.split("-")[0] as Exclude<SourceLanguage, "auto">;
}

/** The target language that matches a source (for the ⇄ swap button). */
export function targetFor(source: Exclude<SourceLanguage, "auto">): TargetLanguage {
  switch (source) {
    case "EN":
      return "EN-GB";
    case "ZH":
      return "ZH-HANS";
    default:
      return source;
  }
}

/** Default target: the UI language (translate foreign text into your own). */
export function defaultTarget(locale: Locale): TargetLanguage {
  return targetFor(locale.toUpperCase() as Exclude<SourceLanguage, "auto">);
}

/** Message key for a stored code (old rows: "DE", "ZH", "ZH-HANS"…), or null if unknown. */
export function languageLabelKey(code: string): string | null {
  const upper = code.toUpperCase();
  return (
    [...SOURCE_LANGUAGES, ...TARGET_LANGUAGES].find((l) => l.code === upper)?.labelKey ??
    // Regional variants DeepL may report or that we don't offer as a target (EN-US, PT-BR…).
    [...SOURCE_LANGUAGES].find((l) => l.code === upper.split("-")[0])?.labelKey ??
    null
  );
}
