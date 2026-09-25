import {
  AVAILABILITY_INFO,
  blockTitle,
  blocksStartingOn,
  describeStatus,
  statusAt,
  type Schedule,
} from "@/lib/schedule/schedule";
import { formatMinute, zonedParts } from "@/lib/schedule/time";

interface PromptInput {
  name: string;
  timezone: string;
  schedule: Schedule | null;
  now?: Date;
}

function formatNow(now: Date, timeZone: string) {
  return new Intl.DateTimeFormat("de-DE", {
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
 * The system prompt: who the assistant talks to, their local time, and
 * today's Wochenplan — so "wann hab ich heute frei?" or "wie spät ist es
 * jetzt in Deutschland?" just work. AI_USER_CONTEXT (optional env) adds
 * free-form background ("Ich trainiere Kung Fu in Dengfeng …").
 */
export function buildSystemPrompt({ name, timezone, schedule, now = new Date() }: PromptInput): string {
  const lines = [
    `Du bist der persönliche KI-Assistent von ${name} in der privaten App „Encrypted Pigeon“.`,
    "Antworte auf Deutsch, außer du wirst in einer anderen Sprache angesprochen. Sei präzise, ehrlich und hilfreich, komm schnell auf den Punkt und nutze Markdown (Listen, **fett**, Tabellen, Code) nur, wo es die Antwort klarer macht.",
    "Wenn du etwas nicht sicher weißt, sag das offen, statt zu raten. Du hast keinen Internetzugang: Bei aktuellen Ereignissen, Preisen, Öffnungszeiten, Wetter oder Fahrplänen weise darauf hin, dass dein Wissen veraltet sein kann.",
    "",
    "Kontext:",
    `- Datum und Uhrzeit bei ${name}: ${formatNow(now, timezone)} (Zeitzone ${timezone})`,
  ];
  if (timezone !== "Europe/Berlin") {
    lines.push(`- In Deutschland ist es gerade: ${formatNow(now, "Europe/Berlin")}`);
  }

  const background = process.env.AI_USER_CONTEXT?.trim();
  if (background) lines.push(`- Über ${name}: ${background}`);

  if (schedule) {
    const today = zonedParts(now, schedule.timezone).dateKey;
    const blocks = blocksStartingOn(schedule, today);
    if (blocks.length > 0) {
      lines.push(`- ${name}s Wochenplan heute (Zeiten in ${schedule.timezone}):`);
      for (const block of blocks) {
        lines.push(
          `  - ${formatMinute(block.start_minute)}–${formatMinute(block.end_minute)} ${blockTitle(block)} (${AVAILABILITY_INFO[block.availability].label})`
        );
      }
    }
    const status = statusAt(schedule, now);
    if (status) lines.push(`- Gerade laut Plan: ${describeStatus(status, now, schedule.timezone)}`);
  }

  return lines.join("\n");
}

/** A short conversation title from the first question. */
export function titleFrom(question: string): string {
  const oneLine = question.replace(/\s+/g, " ").trim();
  return oneLine.length > 60 ? `${oneLine.slice(0, 57)}…` : oneLine;
}
