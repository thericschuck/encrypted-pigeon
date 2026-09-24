"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Database } from "@/lib/supabase/types";
import { previewOf, type ChatListItem } from "@/lib/chat/chat-overview";
import {
  noteChatActivity,
  onChatRead,
  rememberChatList,
  sortByActivity,
  withLatestActivity,
} from "@/lib/chat/chat-list-store";
import { isChatInView } from "@/lib/chat/use-chat-read-state";
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
const APP_TITLE = "Encrypted Pigeon";

/** "(3) Encrypted Pigeon" in the tab, and the number on the installed app's icon. */
function showUnreadTotal(total: number) {
  document.title = total > 0 ? `(${total}) ${APP_TITLE}` : APP_TITLE;
  if (!("setAppBadge" in navigator)) return;
  const badge = total > 0 ? navigator.setAppBadge(total) : navigator.clearAppBadge();
  badge.catch(() => {
    // Not allowed here (e.g. not installed) — the list shows the counts anyway.
  });
}

interface LiveChatListProps {
  userId: string;
  chats: ChatListItem[];
  membersWithoutChat: MemberProfile[];
  /**
   * Only subscribe while this media query matches — the chat sidebar is
   * hidden below md, so keeping it live there would be wasted traffic.
   */
  media?: string;
  /**
   * How to get a fresh list from the server when events may have been
   * missed. Defaults to router.refresh() (server-rendered list); the chat
   * sidebar loads its list in the browser and reloads just that instead of
   * re-rendering the whole chat route.
   */
  onStale?: () => void;
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
export function LiveChatList({ userId, chats, membersWithoutChat, media, onStale }: LiveChatListProps) {
  const router = useRouter();
  const pathname = usePathname();
  const openChatId = pathname.startsWith("/chat/") ? pathname.slice("/chat/".length) : null;
  const openChatIdRef = useRef(openChatId);
  openChatIdRef.current = openChatId;
  const onStaleRef = useRef(onStale);
  onStaleRef.current = onStale;
  const [items, setItems] = useState(() => withLatestActivity(chats));
  const itemsRef = useRef(items);
  itemsRef.current = items;

  // A fresh server render (navigation, router.refresh) replaces the list,
  // topped up with anything newer this tab has already seen.
  useEffect(() => {
    setItems(withLatestActivity(chats));
  }, [chats]);

  // Lets the next list that mounts (dashboard → chat sidebar) start from
  // this state instead of loading it again.
  useEffect(() => {
    rememberChatList(items, membersWithoutChat);
  }, [items, membersWithoutChat]);
  // …stamped again on unmount: up to that moment it was live, not stale.
  const membersRef = useRef(membersWithoutChat);
  membersRef.current = membersWithoutChat;
  useEffect(() => () => rememberChatList(itemsRef.current, membersRef.current), []);

  // <ChatRoom /> marked a chat read (opened, or new messages seen live).
  useEffect(
    () =>
      onChatRead((chatId) =>
        setItems((prev) =>
          prev.some((chat) => chat.chatId === chatId && chat.unreadCount > 0)
            ? prev.map((chat) => (chat.chatId === chatId ? { ...chat, unreadCount: 0 } : chat))
            : prev
        )
      ),
    []
  );

  // The chat that's open next to the list doesn't count — it's being read.
  const unreadTotal = items.reduce(
    (sum, chat) => (chat.chatId === openChatId ? sum : sum + chat.unreadCount),
    0
  );
  // Also after every navigation: Next resets the tab title from the page metadata.
  useEffect(() => {
    showUnreadTotal(unreadTotal);
  }, [unreadTotal, pathname]);

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
      refreshTimer = setTimeout(() => (onStaleRef.current ?? router.refresh)(), REFRESH_DEBOUNCE_MS);
    }

    const isKnownChat = (chatId: string | null) =>
      !!chatId && itemsRef.current.some((chat) => chat.chatId === chatId);
    // Each message counts as unread at most once, however often it arrives
    // (realtime insert, a landed letter fetched again after a later update).
    const countedIds = new Set<string>();

    function applyMessage(
      message: Pick<MessageRow, "id" | "chat_id" | "sender_id" | "kind" | "content" | "image_url" | "audio_url" | "video_url" | "created_at">
    ) {
      if (!isKnownChat(message.chat_id)) {
        scheduleRefresh();
        return;
      }
      // Unread unless it's mine, or its chat is open and on screen right now.
      const seenLive = message.chat_id === openChatIdRef.current && isChatInView();
      const countsAsUnread = message.sender_id !== userId && !seenLive && !countedIds.has(message.id);
      if (countsAsUnread) countedIds.add(message.id);
      const lastMessage = {
        preview: previewOf(message),
        kind: message.kind,
        createdAt: message.created_at,
        fromMe: message.sender_id === userId,
      };
      noteChatActivity(message.chat_id, lastMessage);
      setItems((prev) =>
        sortByActivity(
          prev.map((chat) => {
            if (chat.chatId !== message.chat_id) return chat;
            const isNewest =
              !chat.lastMessage || Date.parse(lastMessage.createdAt) > Date.parse(chat.lastMessage.createdAt);
            if (!isNewest && !countsAsUnread) return chat;
            return {
              ...chat,
              lastMessage: isNewest ? lastMessage : chat.lastMessage,
              unreadCount: countsAsUnread ? chat.unreadCount + 1 : chat.unreadCount,
            };
          })
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
        .select("id, chat_id, sender_id, kind, content, image_url, audio_url, video_url, created_at")
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
