"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// Coalesces bursts (a message + its flight row arrive together) into one
// server re-render.
const REFRESH_DEBOUNCE_MS = 600;

interface ChatListLiveRefreshProps {
  /**
   * Only refresh while this media query matches — the chat sidebar is
   * hidden below md, and refreshing an invisible list would re-render the
   * whole chat page on the server for every incoming message.
   */
  media?: string;
}

/**
 * Keeps the server-rendered chat list (dashboard + chat sidebar) current:
 * any new message or flight change the user can see triggers a
 * router.refresh(). RLS decides which rows arrive, so this never sees
 * other people's chats or the content of letters still in flight.
 */
export function ChatListLiveRefresh({ media }: ChatListLiveRefreshProps) {
  const router = useRouter();

  useEffect(() => {
    if (media && !window.matchMedia(media).matches) return;
    const supabase = createClient();
    let channel: ReturnType<typeof supabase.channel> | undefined;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const scheduleRefresh = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => router.refresh(), REFRESH_DEBOUNCE_MS);
    };

    // Same session-hydration wait as in <ChatRoom />: subscribing before
    // the session is restored would authorize as anon and receive nothing.
    supabase.auth.getSession().then(() => {
      if (cancelled) return;
      channel = supabase
        .channel("chat-list")
        .on("postgres_changes", { event: "INSERT", schema: "pigeon", table: "messages" }, scheduleRefresh)
        .on("postgres_changes", { event: "*", schema: "pigeon", table: "pigeon_flights" }, scheduleRefresh)
        .subscribe();
    });

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") scheduleRefresh();
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (channel) supabase.removeChannel(channel);
    };
  }, [media, router]);

  return null;
}
