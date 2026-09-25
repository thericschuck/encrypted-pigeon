import { createClient } from "@/lib/supabase/server";
import { isAdminEmail } from "@/lib/auth/admin-email";
import { loadSchedules } from "@/lib/schedule/schedule";
import { displayNameOf, MEMBER_PROFILE_COLUMNS, type MemberProfile } from "@/lib/profile";
import { DeepSeekError, modelFor, streamChat, type AiMode, type ChatMessage } from "@/lib/ai/deepseek";
import { buildSystemPrompt, titleFrom } from "@/lib/ai/context";
import { AI_HISTORY_MESSAGES, AI_MAX_QUESTION_CHARS, type AiStreamEvent } from "@/lib/ai/protocol";

export const dynamic = "force-dynamic";
// The reasoner can think for a minute or more before answering.
export const maxDuration = 300;

function json(status: number, error: string) {
  return Response.json({ error }, { status });
}

/**
 * POST { conversationId?, message, mode } → NDJSON stream of AiStreamEvent.
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

  let body: { conversationId?: unknown; message?: unknown; mode?: unknown };
  try {
    body = await request.json();
  } catch {
    return json(400, "Ungültige Anfrage.");
  }
  const question = typeof body.message === "string" ? body.message.trim() : "";
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
      .insert({ owner_id: user.id, title: titleFrom(question) })
      .select("id")
      .single();
    if (error || !data) return json(500, `Unterhaltung konnte nicht angelegt werden: ${error?.message}`);
    conversationId = data.id;
  }

  const [{ data: profile }, { data: previous }] = await Promise.all([
    supabase.from("profiles").select(MEMBER_PROFILE_COLUMNS).eq("id", user.id).single(),
    supabase
      .from("ai_messages")
      .select("role, content")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false })
      .limit(AI_HISTORY_MESSAGES),
  ]);
  const { error: insertError } = await supabase
    .from("ai_messages")
    .insert({ conversation_id: conversationId, role: "user", content: question });
  if (insertError) return json(500, `Frage konnte nicht gespeichert werden: ${insertError.message}`);

  const me = profile as MemberProfile | null;
  const timezone = me?.timezone ?? "Europe/Berlin";
  const schedule = me ? ((await loadSchedules(supabase, [me]))[me.id] ?? null) : null;
  const messages: ChatMessage[] = [
    { role: "system", content: buildSystemPrompt({ name: displayNameOf(me), timezone, schedule }) },
    ...(previous ?? []).reverse().map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: question },
  ];

  const model = modelFor(mode);
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
      send({ type: "meta", conversationId: conversationId!, model });

      let content = "";
      let reasoning = "";
      let failure: string | null = null;
      try {
        for await (const chunk of streamChat(messages, mode, upstream.signal)) {
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
            model,
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
