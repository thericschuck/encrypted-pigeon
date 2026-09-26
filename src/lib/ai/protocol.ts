/** Shared between /api/ai/chat and the browser: one JSON object per line. */
export type AiStreamEvent =
  | { type: "meta"; conversationId: string; model: string }
  | { type: "reasoning"; text: string }
  | { type: "content"; text: string }
  | { type: "done"; messageId: string }
  | { type: "error"; message: string };

/** Earlier messages sent along as context (the system prompt comes on top). */
export const AI_HISTORY_MESSAGES = 30;
export const AI_MAX_QUESTION_CHARS = 8000;

export const AI_IMAGE_BUCKET = "pigeon-ai-images";
export const AI_MAX_IMAGES_PER_MESSAGE = 4;
/** Only the photos of the newest few image messages are sent again. */
export const AI_MAX_IMAGE_MESSAGES_IN_CONTEXT = 3;
/** Longest side of an uploaded photo — enough to read small print on a label. */
export const AI_IMAGE_MAX_DIMENSION = 1600;

export const AI_MAX_MEMORIES = 100;
export const AI_MAX_MEMORY_CHARS = 500;
export const AI_MAX_INSTRUCTIONS_CHARS = 4000;

/**
 * The assistant suggests memory entries as "[[merken: …]]" lines at the end
 * of an answer (see lib/ai/context.ts). They're cut out of the shown text
 * and offered as "Merken?" chips instead — saved only on confirmation.
 * A marker still being streamed ("[[mer…") is hidden too.
 */
const MEMORY_MARKER = /\[\[\s*merken\s*:\s*([^\]]+?)\s*\]\]/gi;
const PARTIAL_MARKER = /\[\[[^\]]*\]?$/;

export function splitMemorySuggestions(content: string): { text: string; suggestions: string[] } {
  const suggestions = Array.from(content.matchAll(MEMORY_MARKER), (m) => m[1].trim()).filter(Boolean);
  const text = content.replace(MEMORY_MARKER, "").replace(PARTIAL_MARKER, "").trimEnd();
  return { text, suggestions };
}
