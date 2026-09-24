"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Database } from "@/lib/supabase/types";
import { previewOf, type ChatListItem } from "@/lib/chat/chat-overview";
import { noteChatActivity, sortByActivity, withLatestActivity } from "@/lib/chat/chat-list-store";
import type { MemberProfile } from "@/lib/profile";
import { ChatList } from "@/components/dashboard/chat-list";

type MessageRow = Database["pigeon"]["Tables"]["messages"]["Row"];
type FlightRow = Database["pigeon"]["Tables"]["pigeon_flights"]["Row"];

// After the app was in the background this long, re-render the list from
// the server once on return, in case the socket silently missed events.
const STALE_AFTER_HIDDEN_MS = 5 * 60 * 1000;
// Coalesces bursts (a new chat's message + its flight row) into one
// server re-render.
const REFRESH_DEBOUNCE_MS = 600;

interface LiveChatListProps {
  userId: string;
  chats: ChatListItem[];
  membersWithoutChat: MemberProfile[];
  /**
   * Only subscribe while this media query matches — the chat sidebar is
   * hidden below md, so keeping it live there would be wasted traffic.
   */
  media?: string;
}

/**
 * The chat list (dashboard + chat sidebar), kept current from realtime
 * events in the browser: new messages and flight changes update the
 * affected row directly, without asking the server to re-render the page.
 * The server is only asked again (router.refresh) when something appears
 * that the list can't place — a chat it doesn't know yet — or after a
 * reconnect / long background, when events may have been missed.
 *
 * RLS decides which rows arrive, so this never sees other people's chats
 * or the content of letters still in flight.
 */
export function LiveChatList({ userId, chats, membersWithoutChat, media }: LiveChatListProps) {
  const router = useRouter();
  const [items, setItems] = useState(() => withLatestActivity(chats));
  const itemsRef = useRef(items);
  itemsRef.current = items;

  // A fresh server render (navigation, router.refresh) replaces the list,
  // topped up with anything newer this tab has already seen.
  useEffect(() => {
    setItems(withLatestActivity(chats));
  }, [chats]);

  useEffect(() => {
    if (media && !window.matchMedia(media).matches) return;
    const supabase = createClient();
    let channel: ReturnType<typeof supabase.channel> | undefined;
    let cancelled = false;
    let hasSubscribedOnce = false;
    let hiddenSince: number | null = null;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;

    function scheduleRefresh() {
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => router.refresh(), REFRESH_DEBOUNCE_MS);
    }

    const isKnownChat = (chatId: string | null) =>
      !!chatId && itemsRef.current.some((chat) => chat.chatId === chatId);

    function applyMessage(message: Pick<MessageRow, "chat_id" | "sender_id" | "kind" | "content" | "image_url" | "audio_url" | "created_at">) {
      if (!isKnownChat(message.chat_id)) {
        scheduleRefresh();
        return;
      }
      const lastMessage = {
        preview: previewOf(message),
        kind: message.kind,
        createdAt: message.created_at,
        fromMe: message.sender_id === userId,
      };
      noteChatActivity(message.chat_id, lastMessage);
      setItems((prev) =>
        sortByActivity(
          prev.map((chat) =>
            chat.chatId === message.chat_id &&
            (!chat.lastMessage || Date.parse(lastMessage.createdAt) > Date.parse(chat.lastMessage.createdAt))
              ? { ...chat, lastMessage }
              : chat
          )
        )
      );
    }

    async function applyFlight(flight: FlightRow) {
      if (!flight.sender_id || flight.sender_id === userId) return;
      if (!isKnownChat(flight.chat_id)) {
        scheduleRefresh();
        return;
      }
      const inTheAir = flight.status !== "delivered";
      setItems((prev) =>
        prev.map((chat) => {
          if (chat.chatId !== flight.chat_id) return chat;
          const has = chat.incomingLetterIds.includes(flight.message_id);
          if (inTheAir === has) return chat;
          return {
            ...chat,
            incomingLetterIds: inTheAir
              ? [...chat.incomingLetterIds, flight.message_id]
              : chat.incomingLetterIds.filter((id) => id !== flight.message_id),
          };
        })
      );
      if (inTheAir) return;
      // Landed: RLS lets me read the letter now, but its INSERT happened
      // (invisibly to me) at send time — fetch it for the preview.
      const { data } = await supabase
        .from("messages")
        .select("chat_id, sender_id, kind, content, image_url, audio_url, created_at")
        .eq("id", flight.message_id)
        .maybeSingle();
      if (data && !cancelled) applyMessage(data);
    }

    // Same session-hydration wait as in <ChatRoom />: subscribing before
    // the session is restored would authorize as anon and receive nothing.
    supabase.auth.getSession().then(() => {
      if (cancelled) return;
      channel = supabase
        .channel("chat-list")
        .on("postgres_changes", { event: "INSERT", schema: "pigeon", table: "messages" }, (payload) =>
          applyMessage(payload.new as MessageRow)
        )
        .on("postgres_changes", { event: "*", schema: "pigeon", table: "pigeon_flights" }, (payload) => {
          if (payload.eventType === "DELETE") return;
          void applyFlight(payload.new as FlightRow);
        })
        .subscribe((status) => {
          // Every SUBSCRIBED after the first one is a reconnect — anything
          // sent in between never reached us as an event.
          if (status === "SUBSCRIBED") {
            if (hasSubscribedOnce) scheduleRefresh();
            hasSubscribedOnce = true;
          }
        });
    });

    function handleVisibilityChange() {
      if (document.visibilityState === "hidden") {
        hiddenSince = Date.now();
        return;
      }
      if (hiddenSince !== null && Date.now() - hiddenSince > STALE_AFTER_HIDDEN_MS) scheduleRefresh();
      hiddenSince = null;
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      cancelled = true;
      if (refreshTimer) clearTimeout(refreshTimer);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (channel) supabase.removeChannel(channel);
    };
  }, [media, router, userId]);

  return <ChatList chats={items} membersWithoutChat={membersWithoutChat} />;
}
