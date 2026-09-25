/**
 * Minimal DeepSeek client (OpenAI-compatible chat completions, streamed).
 * Server-only: needs DEEPSEEK_API_KEY. The browser never talks to DeepSeek
 * — it talks to /api/ai/chat, which runs outside China, so this works from
 * there without a VPN.
 */

const API_URL = "https://api.deepseek.com/chat/completions";

export type AiMode = "fast" | "deep";

/** Model ids per mode; overridable in case DeepSeek renames them. */
export function modelFor(mode: AiMode): string {
  return mode === "deep"
    ? process.env.DEEPSEEK_REASONER_MODEL || "deepseek-reasoner"
    : process.env.DEEPSEEK_CHAT_MODEL || "deepseek-chat";
}

export function isDeepSeekConfigured(): boolean {
  return !!process.env.DEEPSEEK_API_KEY;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export type StreamChunk = { type: "reasoning" | "content"; text: string };

export class DeepSeekError extends Error {}

function errorText(status: number, body: string): string {
  if (status === 401) return "DeepSeek lehnt den API-Key ab (401). Ist DEEPSEEK_API_KEY richtig gesetzt?";
  if (status === 402) return "Kein Guthaben mehr bei DeepSeek (402). Bitte auf platform.deepseek.com aufladen.";
  if (status === 429) return "Zu viele Anfragen an DeepSeek (429). Kurz warten und nochmal versuchen.";
  if (status >= 500) return `DeepSeek ist gerade überlastet oder gestört (${status}). Bitte gleich nochmal versuchen.`;
  let detail = body.slice(0, 200);
  try {
    detail = JSON.parse(body)?.error?.message ?? detail;
  } catch {
    // Not JSON — keep the raw snippet.
  }
  return `DeepSeek-Fehler ${status}: ${detail}`;
}

/**
 * Streams one answer as reasoning/content deltas (reasoning only comes
 * from the reasoner model). Throws DeepSeekError for API errors.
 */
export async function* streamChat(
  messages: ChatMessage[],
  mode: AiMode,
  signal?: AbortSignal
): AsyncGenerator<StreamChunk> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new DeepSeekError("DEEPSEEK_API_KEY ist nicht gesetzt.");

  const response = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: modelFor(mode),
      messages,
      stream: true,
      // The reasoner ignores temperature; for chat a bit below default
      // keeps factual answers steadier.
      ...(mode === "fast" ? { temperature: 0.7 } : {}),
    }),
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
