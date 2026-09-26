/**
 * Minimal DeepSeek client (OpenAI-compatible chat completions, streamed).
 * Server-only: needs DEEPSEEK_API_KEY. The browser never talks to DeepSeek
 * — it talks to /api/ai/chat, which runs outside China, so this works from
 * there without a VPN.
 *
 * Models (V4, since 2026-07-24 the old deepseek-chat/-reasoner names are
 * gone): Flash without thinking for "Schnell", Pro with thinking for
 * "Gründlich", and the experimental vision model whenever photos are in
 * play (V4-Flash/-Pro themselves are text-only). All overridable by env.
 */

const API_URL = "https://api.deepseek.com/chat/completions";

export type AiMode = "fast" | "deep";

export function isDeepSeekConfigured(): boolean {
  return !!process.env.DEEPSEEK_API_KEY;
}

export type ContentPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string | ContentPart[];
}

export interface ModelChoice {
  model: string;
  /** Extra request fields (thinking switch). */
  params: Record<string, unknown>;
}

export function chooseModel(mode: AiMode, withImages: boolean): ModelChoice {
  if (withImages) {
    // Experimental endpoint: no documented thinking support, so none asked for.
    return { model: process.env.DEEPSEEK_VISION_MODEL || "deepseek-v4-flash-vision-exp", params: {} };
  }
  if (mode === "deep") {
    return {
      model: process.env.DEEPSEEK_DEEP_MODEL || "deepseek-v4-pro",
      params: { thinking: { type: "enabled" }, reasoning_effort: "high" },
    };
  }
  return {
    model: process.env.DEEPSEEK_FAST_MODEL || "deepseek-v4-flash",
    params: { thinking: { type: "disabled" }, temperature: 0.7 },
  };
}

export type StreamChunk = { type: "reasoning" | "content"; text: string };

export class DeepSeekError extends Error {}

function errorText(status: number, body: string): string {
  if (status === 401) return "DeepSeek lehnt den API-Key ab (401). Ist DEEPSEEK_API_KEY richtig gesetzt?";
  if (status === 402) return "Kein Guthaben mehr bei DeepSeek (402). Bitte auf platform.deepseek.com aufladen.";
  if (status === 429) return "Zu viele Anfragen an DeepSeek (429). Kurz warten und nochmal versuchen.";
  if (status >= 500) return `DeepSeek ist gerade überlastet oder gestört (${status}). Bitte gleich nochmal versuchen.`;
  let detail = body.slice(0, 300);
  try {
    detail = JSON.parse(body)?.error?.message ?? detail;
  } catch {
    // Not JSON — keep the raw snippet.
  }
  return `DeepSeek-Fehler ${status}: ${detail}`;
}

/**
 * Streams one answer as reasoning/content deltas (reasoning only in
 * thinking mode). Throws DeepSeekError for API errors.
 */
export async function* streamChat(
  messages: ChatMessage[],
  choice: ModelChoice,
  signal?: AbortSignal
): AsyncGenerator<StreamChunk> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new DeepSeekError("DEEPSEEK_API_KEY ist nicht gesetzt.");

  const response = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: choice.model, messages, stream: true, ...choice.params }),
    signal,
  });

  if (!response.ok || !response.body) {
    throw new DeepSeekError(errorText(response.status, await response.text().catch(() => "")));
  }

  // Server-sent events: "data: {json}\n\n", ending with "data: [DONE]".
  // Lines starting with ":" are keep-alives while the model is busy.
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newline: number;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") return;
      let delta: { content?: string | null; reasoning_content?: string | null } | undefined;
      try {
        delta = JSON.parse(data)?.choices?.[0]?.delta;
      } catch {
        continue;
      }
      if (delta?.reasoning_content) yield { type: "reasoning", text: delta.reasoning_content };
      if (delta?.content) yield { type: "content", text: delta.content };
    }
  }
}
