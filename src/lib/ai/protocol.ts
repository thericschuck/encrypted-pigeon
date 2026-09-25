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
