import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
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

  const { data: otherProfile } = otherUserId
    ? await supabase
        .from("profiles")
        .select("email, display_name")
        .eq("id", otherUserId)
        .maybeSingle()
    : { data: null };

  const { data: messages } = await supabase
    .from("messages")
    .select("*")
    .eq("chat_id", params.chatId)
    .order("created_at", { ascending: true });

  return (
    <main className="flex h-screen flex-col">
      <header className="border-b border-neutral-200 px-4 py-3">
        <h1 className="text-sm font-semibold text-neutral-500">
          Chat mit{" "}
          {otherProfile?.display_name ?? otherProfile?.email ?? "jemandem"}
        </h1>
      </header>
      <div className="min-h-0 flex-1">
        <ChatRoom
          chatId={params.chatId}
          currentUserId={user.id}
          initialMessages={messages ?? []}
        />
      </div>
    </main>
  );
}
