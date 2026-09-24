import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/current-user";
import { ChatSidebar } from "@/components/dashboard/chat-sidebar";

/**
 * From md up the chat list stays visible as a sidebar, so switching chats
 * is one click. On phones it's hidden — the chat header's back arrow leads
 * to the dashboard instead. <ChatSidebar /> loads the list in the browser,
 * and only on screens that show it, so opening a chat costs no extra
 * queries here.
 */
export default async function ChatLayout({ children }: { children: React.ReactNode }) {
  // page.tsx handles the signed-out redirect; the middleware already
  // guarantees a user here in practice. (Local JWT check, shared with the
  // page via cache().)
  const user = await getCurrentUser();

  return (
    <div className="flex h-[100dvh]">
      {user && (
        <aside className="hidden w-80 flex-shrink-0 flex-col border-r border-neutral-200 md:flex dark:border-night-border">
          <div className="flex items-center justify-between px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
            <Link href="/" className="text-sm font-semibold">
              🕊️ Encrypted Pigeon
            </Link>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-4">
            <ChatSidebar userId={user.id} />
          </div>
        </aside>
      )}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
