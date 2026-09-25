import { notFound, redirect } from "next/navigation";
import { getCurrentUser, getServerSupabase } from "@/lib/auth/current-user";
import { isAdminEmail } from "@/lib/auth/admin-email";
import { MEMBER_PROFILE_COLUMNS, type MemberProfile } from "@/lib/profile";
import { isDeepSeekConfigured } from "@/lib/ai/deepseek";
import { SessionWatcher } from "@/components/auth/session-watcher";
import { ThemeSync } from "@/components/theme-sync";
import { AiChat } from "@/components/ai/ai-chat";

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
  const [{ data: profile }, { data: conversations }, { data: messages }] = await Promise.all([
    supabase.from("profiles").select(MEMBER_PROFILE_COLUMNS).eq("id", user.id).maybeSingle(),
    supabase.from("ai_conversations").select("id, title, updated_at").order("updated_at", { ascending: false }).limit(100),
    requestedId
      ? supabase
          .from("ai_messages")
          .select("id, role, content, reasoning, model")
          .eq("conversation_id", requestedId)
          .order("created_at", { ascending: true })
      : Promise.resolve({ data: null }),
  ]);
  const activeId = requestedId && conversations?.some((c) => c.id === requestedId) ? requestedId : null;

  return (
    <main className="flex h-[100dvh] flex-col">
      <SessionWatcher />
      {profile && (
        <ThemeSync theme={(profile as MemberProfile).theme} accent={(profile as MemberProfile).accent_color} />
      )}
      <AiChat
        configured={isDeepSeekConfigured()}
        initialConversations={conversations ?? []}
        initialConversationId={activeId}
        initialMessages={activeId ? (messages ?? []) : []}
      />
    </main>
  );
}
