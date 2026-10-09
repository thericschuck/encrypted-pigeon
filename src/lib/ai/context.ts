import {
  availabilityLabel,
  blockTitle,
  blocksStartingOn,
  describeStatus,
  statusAt,
  type Schedule,
} from "@/lib/schedule/schedule";
import { intlLocale, type Locale } from "@/lib/i18n/config";
import type { TFunction } from "@/lib/i18n/translate";
import { formatMinute, zonedParts } from "@/lib/schedule/time";

interface PromptInput {
  name: string;
  timezone: string;
  schedule: Schedule | null;
  /** The owner's own instructions (how to answer), editable in /ai. */
  instructions: string;
  /** Facts the owner saved about themselves, editable in /ai. */
  memories: string[];
  /** The user's UI language: the assistant answers in it. */
  locale: Locale;
  /** Translator for `locale` (schedule labels in the prompt). */
  t: TFunction;
  now?: Date;
}

// English names, so the model is unambiguous whatever the prompt language.
const REPLY_LANGUAGE: Record<Locale, string> = {
  de: "German (Deutsch)",
  en: "English",
  fr: "French (français)",
  zh: "Simplified Chinese (简体中文)",
};

function formatNow(now: Date, timeZone: string, locale: Locale) {
  return new Intl.DateTimeFormat(intlLocale(locale), {
    timeZone,
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(now);
}

/**
 * The system prompt: who the assistant talks to, their own instructions
 * and saved memory, their local time and today's Wochenplan — so "wann hab
 * ich heute frei?" or "was ist das?" (photo from a shop in Dengfeng) get
 * answers that fit.
 */
export function buildSystemPrompt({ name, timezone, schedule, instructions, memories, locale, t, now = new Date() }: PromptInput): string {
  const lines = [
    `Du bist der persönliche KI-Assistent von ${name} in der privaten App „Encrypted Pigeon“.`,
    `Antworte standardmäßig auf ${REPLY_LANGUAGE[locale]}: Das ist die Sprache der App-Oberfläche von ${name}. Wechsle die Sprache nur, wenn ${name} dich ausdrücklich darum bittet oder eine Übersetzung verlangt. Sei präzise, ehrlich und hilfreich, komm schnell auf den Punkt und nutze Markdown (Listen, **fett**, Tabellen, Code) nur, wo es die Antwort klarer macht.`,
    "Wenn du etwas nicht sicher weißt, sag das offen, statt zu raten. Du hast keinen Internetzugang: Bei aktuellen Ereignissen, Preisen, Öffnungszeiten, Wetter oder Fahrplänen weise darauf hin, dass dein Wissen veraltet sein kann.",
    "Bei Fotos (z.B. Produkte, Verpackungen, Schilder, Speisekarten, Medikamente): lies chinesischen Text vollständig ab, übersetze ihn, erkläre was es ist und wofür man es benutzt, und nenne Warnhinweise. Gib bei Medikamenten und Inhaltsstoffen an, wenn du dir nicht sicher bist.",
  ];

  if (memories.length > 0) {
    lines.push("", `Was du über ${name} weißt (von ${name} selbst gespeichert):`);
    for (const memory of memories) lines.push(`- ${memory}`);
  }

  if (instructions.trim()) {
    lines.push(
      "",
      `Anweisungen von ${name}, wie du antworten sollst (haben Vorrang vor den allgemeinen Stilregeln oben):`,
      instructions.trim()
    );
  }

  lines.push(
    "",
    "Gedächtnis: Wenn dir der Nutzer in diesem Gespräch etwas Dauerhaftes über sich erzählt, das künftige Antworten verbessert (Wohnort, Tätigkeit, Vorlieben, Allergien, Ziele …) und das oben noch nicht steht, schreib ganz am Ende deiner Antwort eine eigene Zeile im Format [[merken: kurzer Fakt in der Ich-Form]]. Höchstens eine solche Zeile pro Antwort, nur bei wirklich neuen, dauerhaften Fakten, nie für Belangloses. Der Nutzer entscheidet selbst, ob es gespeichert wird.",
    "",
    "Kontext:",
    `- Datum und Uhrzeit bei ${name}: ${formatNow(now, timezone, locale)} (Zeitzone ${timezone})`
  );
  if (timezone !== "Europe/Berlin") {
    lines.push(`- In Deutschland ist es gerade: ${formatNow(now, "Europe/Berlin", locale)}`);
  }

  if (schedule) {
    const today = zonedParts(now, schedule.timezone).dateKey;
    const blocks = blocksStartingOn(schedule, today);
    if (blocks.length > 0) {
      lines.push(`- ${name}s Wochenplan heute (Zeiten in ${schedule.timezone}):`);
      for (const block of blocks) {
        lines.push(
          `  - ${formatMinute(block.start_minute)}–${formatMinute(block.end_minute)} ${blockTitle(block, t)} (${availabilityLabel(t, block.availability)})`
        );
      }
    }
    const status = statusAt(schedule, now);
    if (status) lines.push(`- Gerade laut Plan: ${describeStatus(status, now, schedule.timezone, t, locale)}`);
  }

  return lines.join("\n");
}

/** A short conversation title from the first question. */
export function titleFrom(question: string, hasImages: boolean, t: TFunction): string {
  const oneLine = question.replace(/\s+/g, " ").trim();
  if (!oneLine) return hasImages ? `📷 ${t("ai.photoTitle")}` : t("ai.untitled");
  const title = oneLine.length > 60 ? `${oneLine.slice(0, 57)}…` : oneLine;
  return hasImages ? `📷 ${title}` : title;
}
