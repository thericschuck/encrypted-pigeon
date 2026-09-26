import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/types";
import { isAdminEmail } from "@/lib/auth/admin-email";
import { loadSchedules } from "@/lib/schedule/schedule";
import { displayNameOf, MEMBER_PROFILE_COLUMNS, type MemberProfile } from "@/lib/profile";
import {
  DeepSeekError,
  chooseModel,
  streamChat,
  type AiMode,
  type ChatMessage,
  type ContentPart,
} from "@/lib/ai/deepseek";
import { buildSystemPrompt, titleFrom } from "@/lib/ai/context";
import {
  AI_HISTORY_MESSAGES,
  AI_IMAGE_BUCKET,
  AI_MAX_IMAGES_PER_MESSAGE,
  AI_MAX_IMAGE_MESSAGES_IN_CONTEXT,
  AI_MAX_MEMORIES,
  AI_MAX_QUESTION_CHARS,
  splitMemorySuggestions,
  type AiStreamEvent,
} from "@/lib/ai/protocol";

export const dynamic = "force-dynamic";
// Thinking mode can take a minute or more before the answer starts.
export const maxDuration = 300;

type PigeonClient = SupabaseClient<Database, "pigeon">;

// A photo sent without a question.
const DEFAULT_IMAGE_QUESTION = "Was ist das? Lies den Text ab, übersetze ihn und erklär mir, was es ist.";

function json(status: number, error: string) {
  return Response.json({ error }, { status });
}

/** A stored photo as a data URL (read with the owner's session, RLS-checked). */
async function imageDataUrl(supabase: PigeonClient, path: string): Promise<string | null> {
  const { data } = await supabase.storage.from(AI_IMAGE_BUCKET).download(path);
  if (!data) return null;
  const base64 = Buffer.from(await data.arrayBuffer()).toString("base64");
  return `data:${data.type || "image/jpeg"};base64,${base64}`;
}

interface StoredMessage {
  role: "user" | "assistant";
  content: string;
  images: string[];
}

/**
 * The conversation as DeepSeek sees it. Photos are sent again for the
 * newest few messages that had any (so follow-ups about "das Produkt"
 * work); older ones are only mentioned, to keep requests small.
 */
async function toChatMessages(supabase: PigeonClient, history: StoredMessage[]): Promise<{ messages: ChatMessage[]; withImages: boolean }> {
  const imageMessageIndexes = history
    .map((m, i) => (m.images.length > 0 ? i : -1))
    .filter((i) => i >= 0)
    .slice(-AI_MAX_IMAGE_MESSAGES_IN_CONTEXT);

  let withImages = false;
  const messages = await Promise.all(
    history.map(async (m, i): Promise<ChatMessage> => {
      const text = m.role === "assistant" ? splitMemorySuggestions(m.content).text : m.content;
      if (m.images.length === 0) return { role: m.role, content: text };
      if (!imageMessageIndexes.includes(i)) {
        return { role: m.role, content: `${text}\n\n[${m.images.length === 1 ? "Ein Foto" : `${m.images.length} Fotos`} von früher im Gespräch]` };
      }
      const urls = (await Promise.all(m.images.map((path) => imageDataUrl(supabase, path)))).filter(
        (url): url is string => !!url
      );
      if (urls.length === 0) return { role: m.role, content: text };
      withImages = true;
      const parts: ContentPart[] = [
        ...urls.map((url): ContentPart => ({ type: "image_url", image_url: { url } })),
        { type: "text", text },
      ];
      return { role: m.role, content: parts };
    })
  );
  return { messages, withImages };
}

/**
 * POST { conversationId?, message, mode, images? } → NDJSON stream of
 * AiStreamEvent. `images` are paths the browser just uploaded to
 * pigeon-ai-images (own folder only).
 *
 * Stores the question right away and the answer once it's complete (or
 * as far as it got, if the stream breaks off), so the history in the
 * database always matches what was shown.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  // getUser(), not getClaims(): this spends DeepSeek credit, so a session
  // revoked elsewhere must not count. Admin only, like /translate.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !isAdminEmail(user.email)) return json(403, "Nicht berechtigt.");

  let body: { conversationId?: unknown; message?: unknown; mode?: unknown; images?: unknown };
  try {
    body = await request.json();
  } catch {
    return json(400, "Ungültige Anfrage.");
  }
  const images = Array.isArray(body.images)
    ? body.images.filter((p): p is string => typeof p === "string" && p.startsWith(`${user.id}/`) && !p.includes(".."))
    : [];
  if (images.length > AI_MAX_IMAGES_PER_MESSAGE) return json(400, `Höchstens ${AI_MAX_IMAGES_PER_MESSAGE} Fotos auf einmal.`);
  const typed = typeof body.message === "string" ? body.message.trim() : "";
  const question = typed || (images.length > 0 ? DEFAULT_IMAGE_QUESTION : "");
  const mode: AiMode = body.mode === "deep" ? "deep" : "fast";
  if (!question) return json(400, "Bitte eine Frage eingeben.");
  if (question.length > AI_MAX_QUESTION_CHARS) {
    return json(400, `Maximal ${AI_MAX_QUESTION_CHARS.toLocaleString("de-DE")} Zeichen auf einmal.`);
  }

  let conversationId = typeof body.conversationId === "string" ? body.conversationId : null;
  if (conversationId) {
    // RLS: only finds my own conversations.
    const { data } = await supabase.from("ai_conversations").select("id").eq("id", conversationId).maybeSingle();
    if (!data) return json(404, "Unterhaltung nicht gefunden.");
  } else {
    const { data, error } = await supabase
      .from("ai_conversations")
      .insert({ owner_id: user.id, title: titleFrom(typed, images.length > 0) })
      .select("id")
      .single();
    if (error || !data) return json(500, `Unterhaltung konnte nicht angelegt werden: ${error?.message}`);
    conversationId = data.id;
  }

  const [{ data: profile }, { data: previous }, { data: settings }, { data: memories }] = await Promise.all([
    supabase.from("profiles").select(MEMBER_PROFILE_COLUMNS).eq("id", user.id).single(),
    supabase
      .from("ai_messages")
      .select("role, content, images")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false })
      .limit(AI_HISTORY_MESSAGES),
    supabase.from("ai_settings").select("instructions").eq("owner_id", user.id).maybeSingle(),
    supabase
      .from("ai_memories")
      .select("content")
      .eq("owner_id", user.id)
      .order("created_at", { ascending: true })
      .limit(AI_MAX_MEMORIES),
  ]);
  const { error: insertError } = await supabase
    .from("ai_messages")
    .insert({ conversation_id: conversationId, role: "user", content: typed || question, images });
  if (insertError) return json(500, `Frage konnte nicht gespeichert werden: ${insertError.message}`);

  const me = profile as MemberProfile | null;
  const timezone = me?.timezone ?? "Europe/Berlin";
  const schedule = me ? ((await loadSchedules(supabase, [me]))[me.id] ?? null) : null;
  const { messages: conversation, withImages } = await toChatMessages(supabase, [
    ...(previous ?? []).reverse(),
    { role: "user", content: question, images },
  ]);
  const messages: ChatMessage[] = [
    {
      role: "system",
      content: buildSystemPrompt({
        name: displayNameOf(me),
        timezone,
        schedule,
        instructions: settings?.instructions ?? "",
        memories: (memories ?? []).map((m) => m.content),
      }),
    },
    ...conversation,
  ];

  const choice = chooseModel(mode, withImages);
  const encoder = new TextEncoder();
  const upstream = new AbortController();
  // Closing the page / "Stopp" aborts the request; pass that on to DeepSeek
  // so it stops generating (and billing).
  request.signal.addEventListener("abort", () => upstream.abort());

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: AiStreamEvent) => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          // Client already gone — keep collecting so the answer gets saved.
        }
      };
      send({ type: "meta", conversationId: conversationId!, model: choice.model });

      let content = "";
      let reasoning = "";
      let failure: string | null = null;
      try {
        for await (const chunk of streamChat(messages, choice, upstream.signal)) {
          if (chunk.type === "content") content += chunk.text;
          else reasoning += chunk.text;
          send(chunk);
        }
      } catch (error) {
        if (!upstream.signal.aborted) {
          failure =
            error instanceof DeepSeekError
              ? error.message
              : `Verbindung zu DeepSeek unterbrochen: ${error instanceof Error ? error.message : String(error)}`;
        }
      }

      if (content || reasoning) {
        const { data: saved } = await supabase
          .from("ai_messages")
          .insert({
            conversation_id: conversationId!,
            role: "assistant",
            content: content || "…",
            reasoning: reasoning || null,
            model: choice.model,
          })
          .select("id")
          .single();
        if (saved && !failure) send({ type: "done", messageId: saved.id });
      }
      await supabase
        .from("ai_conversations")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", conversationId!);
      if (failure) send({ type: "error", message: failure });
      try {
        controller.close();
      } catch {
        // Already closed by the client.
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      // Keeps proxies (and Vercel's edge) from buffering the stream.
      "X-Accel-Buffering": "no",
    },
  });
}
