import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { MEMBER_PROFILE_COLUMNS, displayNameOf, type MemberProfile } from "@/lib/profile";
import { SessionWatcher } from "@/components/auth/session-watcher";
import { ThemeSync } from "@/components/theme-sync";
import { Avatar } from "@/components/ui/avatar";
import { ChatRoom } from "./chat-room";

interface ChatPageProps {
  params: { chatId: string };
}

export default async function ChatPage({ params }: ChatPageProps) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // RLS on chat_participants only returns rows for chats the current user
  // is actually part of, so an empty result also covers "not your chat".
  const { data: participants } = await supabase
    .from("chat_participants")
    .select("user_id")
    .eq("chat_id", params.chatId);

  const isParticipant = participants?.some((p) => p.user_id === user.id);
  if (!participants || !isParticipant) {
    notFound();
  }

  const otherUserId = participants.find((p) => p.user_id !== user.id)?.user_id;

  // RLS on messages already hides pigeon letters still in flight to me —
  // they show up as "incoming pigeon" placeholders (from the flight rows)
  // until they land.
  const [{ data: profiles }, { data: messages }] = await Promise.all([
    supabase
      .from("profiles")
      .select(MEMBER_PROFILE_COLUMNS)
      .in("id", otherUserId ? [user.id, otherUserId] : [user.id]),
    supabase
      .from("messages")
      .select("*")
      .eq("chat_id", params.chatId)
      .order("created_at", { ascending: true }),
  ]);

  const me = (profiles ?? []).find((p) => p.id === user.id) as MemberProfile | undefined;
  const partner = ((profiles ?? []).find((p) => p.id === otherUserId) as MemberProfile | undefined) ?? null;

  // No own profile = not a member; the dashboard signs them out properly.
  if (!me) {
    redirect("/");
  }

  return (
    // 100dvh, not h-screen: on mobile Safari/Chrome 100vh includes the area
    // behind the collapsing URL bar, which pushed the composer off-screen.
    <main className="flex h-[100dvh] flex-col">
      <SessionWatcher />
      <ThemeSync theme={me.theme} />
      <header className="flex items-center justify-between gap-3 border-b border-neutral-200 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] dark:border-night-border">
        <div className="flex min-w-0 items-center gap-2.5">
          {/* From md up the chat list is always visible as a sidebar. */}
          <Link
            href="/"
            aria-label="Zurück zu deinen Chats"
            className="flex-shrink-0 text-neutral-400 hover:text-neutral-600 md:hidden dark:text-night-muted dark:hover:text-night-text"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <Avatar profile={partner} size="sm" />
          <h1 className="min-w-0 truncate text-sm font-semibold">{displayNameOf(partner)}</h1>
        </div>
        <Link
          href="/settings"
          aria-label="Einstellungen"
          className="flex-shrink-0 text-neutral-400 hover:text-neutral-600 dark:text-night-muted dark:hover:text-night-text"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            className="h-5 w-5"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
            />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </Link>
      </header>
      <div className="min-h-0 flex-1">
        <ChatRoom
          chatId={params.chatId}
          me={me}
          partner={partner}
          initialMessages={messages ?? []}
        />
      </div>
    </main>
  );
}
