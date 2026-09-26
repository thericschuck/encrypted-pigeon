import { notFound, redirect } from "next/navigation";
import { getCurrentUser, getServerSupabase } from "@/lib/auth/current-user";
import { isAdminEmail } from "@/lib/auth/admin-email";
import { MEMBER_PROFILE_COLUMNS, type MemberProfile } from "@/lib/profile";
import { isDeepSeekConfigured } from "@/lib/ai/deepseek";
import { AI_IMAGE_BUCKET, AI_MAX_MEMORIES } from "@/lib/ai/protocol";
import { SessionWatcher } from "@/components/auth/session-watcher";
import { ThemeSync } from "@/components/theme-sync";
import { AiChat } from "@/components/ai/ai-chat";

const SIGNED_URL_SECONDS = 60 * 60;

interface AiPageProps {
  searchParams: { c?: string };
}

export default async function AiPage({ searchParams }: AiPageProps) {
  const [supabase, user] = await Promise.all([getServerSupabase(), getCurrentUser()]);

  if (!user) {
    redirect("/login");
  }
  // Admin only for now (it spends DeepSeek credit): for everyone else the
  // page doesn't exist. /api/ai/chat checks again.
  if (!isAdminEmail(user.email)) {
    notFound();
  }

  const requestedId = searchParams.c ?? null;
  const [{ data: profile }, { data: conversations }, { data: messages }, { data: settings }, { data: memories }] =
    await Promise.all([
      supabase.from("profiles").select(MEMBER_PROFILE_COLUMNS).eq("id", user.id).maybeSingle(),
      supabase.from("ai_conversations").select("id, title, updated_at").order("updated_at", { ascending: false }).limit(100),
      requestedId
        ? supabase
            .from("ai_messages")
            .select("id, role, content, reasoning, model, images")
            .eq("conversation_id", requestedId)
            .order("created_at", { ascending: true })
        : Promise.resolve({ data: null }),
      supabase.from("ai_settings").select("instructions").eq("owner_id", user.id).maybeSingle(),
      supabase
        .from("ai_memories")
        .select("id, content")
        .eq("owner_id", user.id)
        .order("created_at", { ascending: true })
        .limit(AI_MAX_MEMORIES),
    ]);
  const activeId = requestedId && conversations?.some((c) => c.id === requestedId) ? requestedId : null;
  const initialMessages = activeId ? (messages ?? []) : [];

  const imagePaths = initialMessages.flatMap((m) => m.images);
  const { data: signed } = imagePaths.length
    ? await supabase.storage.from(AI_IMAGE_BUCKET).createSignedUrls(imagePaths, SIGNED_URL_SECONDS)
    : { data: [] };
  const imageUrls = Object.fromEntries(
    (signed ?? []).filter((s) => s.path && s.signedUrl).map((s) => [s.path as string, s.signedUrl as string])
  );

  return (
    <main className="flex h-[100dvh] flex-col">
      <SessionWatcher />
      {profile && (
        <ThemeSync theme={(profile as MemberProfile).theme} accent={(profile as MemberProfile).accent_color} />
      )}
      <AiChat
        userId={user.id}
        configured={isDeepSeekConfigured()}
        initialConversations={conversations ?? []}
        initialConversationId={activeId}
        initialMessages={initialMessages}
        initialImageUrls={imageUrls}
        initialInstructions={settings?.instructions ?? ""}
        initialMemories={memories ?? []}
      />
    </main>
  );
}
