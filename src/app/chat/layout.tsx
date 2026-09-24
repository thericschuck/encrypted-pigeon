import Link from "next/link";
import { getCurrentUser, getServerSupabase } from "@/lib/auth/current-user";
import { loadChatOverview } from "@/lib/chat/chat-overview";
import { LiveChatList } from "@/components/dashboard/live-chat-list";

/**
 * From md up the chat list stays visible as a sidebar, so switching chats
 * is one click. On phones it's hidden — the chat header's back arrow leads
 * to the dashboard instead.
 */
export default async function ChatLayout({ children }: { children: React.ReactNode }) {
  const [supabase, user] = await Promise.all([getServerSupabase(), getCurrentUser()]);

  // page.tsx handles the signed-out redirect; the middleware already
  // guarantees a user here in practice.
  const overview = user ? await loadChatOverview(supabase, user.id) : null;

  return (
    <div className="flex h-[100dvh]">
      {overview && (
        <aside className="hidden w-80 flex-shrink-0 flex-col border-r border-neutral-200 md:flex dark:border-night-border">
          <div className="flex items-center justify-between px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
            <Link href="/" className="text-sm font-semibold">
              🕊️ Encrypted Pigeon
            </Link>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-4">
            <LiveChatList
              userId={user!.id}
              chats={overview.chats}
              membersWithoutChat={overview.membersWithoutChat}
              media="(min-width: 768px)"
            />
          </div>
        </aside>
      )}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
