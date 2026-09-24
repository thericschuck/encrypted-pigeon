"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { loadChatOverview, type ChatListItem } from "@/lib/chat/chat-overview";
import { recallChatList } from "@/lib/chat/chat-list-store";
import type { MemberProfile } from "@/lib/profile";
import { LiveChatList } from "@/components/dashboard/live-chat-list";
import { Skeleton } from "@/components/ui/skeleton";

// Same breakpoint as the sidebar's `md:flex` in app/chat/layout.tsx.
const SIDEBAR_MEDIA = "(min-width: 768px)";
// A list the dashboard showed this recently is taken as is, without
// loading it again (it was live until the moment it unmounted).
const REUSE_LIST_MAX_AGE_MS = 30_000;

interface ChatSidebarProps {
  userId: string;
}

interface SidebarList {
  chats: ChatListItem[];
  membersWithoutChat: MemberProfile[];
}

/**
 * The chat list next to an open chat, from tablet width up.
 *
 * Loaded in the browser, not by the chat layout on the server: the server
 * can't know the screen width, so it used to run the five overview queries
 * on every entry into a chat — on phones too, where the sidebar is hidden.
 * Now phones never load it, and larger screens load it without holding up
 * the chat itself (or reuse what the dashboard just showed).
 */
export function ChatSidebar({ userId }: ChatSidebarProps) {
  const [visible, setVisible] = useState(false);
  const [list, setList] = useState<SidebarList | null>(null);
  const pathname = usePathname();
  // Chat ids already reloaded for — at most once each, so an id that's
  // still missing afterwards (bad link) can't cause a reload loop.
  const reloadedForRef = useRef(new Set<string>());

  useEffect(() => {
    const query = window.matchMedia(SIDEBAR_MEDIA);
    setVisible(query.matches);
    const handleChange = (event: MediaQueryListEvent) => setVisible(event.matches);
    query.addEventListener("change", handleChange);
    return () => query.removeEventListener("change", handleChange);
  }, []);

  const reload = useCallback(async () => {
    const overview = await loadChatOverview(createClient(), userId);
    setList({ chats: overview.chats, membersWithoutChat: overview.membersWithoutChat });
  }, [userId]);

  useEffect(() => {
    if (!visible || list) return;
    const recalled = recallChatList(REUSE_LIST_MAX_AGE_MS);
    if (recalled) setList(recalled);
    else void reload();
  }, [visible, list, reload]);

  // Opened a chat the list doesn't know yet (just started via "Neue
  // Unterhaltung"): reload so it shows up and leaves "Neue Unterhaltung".
  const openChatId = pathname.startsWith("/chat/") ? pathname.slice("/chat/".length) : null;
  useEffect(() => {
    if (!visible || !list || !openChatId || reloadedForRef.current.has(openChatId)) return;
    if (list.chats.some((chat) => chat.chatId === openChatId)) return;
    reloadedForRef.current.add(openChatId);
    void reload();
  }, [visible, list, openChatId, reload]);

  if (!visible) return null;

  if (!list) {
    return (
      <div className="flex flex-col gap-2 px-3 pt-6" aria-label="Chats werden geladen">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="flex items-center gap-3 py-1.5">
            <Skeleton className="h-10 w-10 flex-shrink-0 rounded-full" />
            <div className="flex flex-1 flex-col gap-1.5">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-2.5 w-40" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <LiveChatList
      userId={userId}
      chats={list.chats}
      membersWithoutChat={list.membersWithoutChat}
      onStale={() => void reload()}
    />
  );
}
