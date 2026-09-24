"use client";

import { useCallback, useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { noteChatRead } from "@/lib/chat/chat-list-store";

// Renews "looking at this chat" before the server's 45 s window runs out
// (see supabase/migrations/20260926000000_unread_and_chat_presence.sql).
const HEARTBEAT_MS = 20_000;
// Coalesces a burst of incoming messages into one "read" update.
const MARK_READ_DEBOUNCE_MS = 1_500;

/** Is the chat actually in front of the person — tab visible and window focused? */
export function isChatInView(): boolean {
  return document.visibilityState === "visible" && document.hasFocus();
}

function showAppBadge(total: number) {
  if (!("setAppBadge" in navigator)) return;
  (total > 0 ? navigator.setAppBadge(total) : navigator.clearAppBadge()).catch(() => {
    // Not allowed here (e.g. not installed).
  });
}

/** Closes this chat's notifications on this device — they've been read in the app. */
async function closeChatNotifications(chatId: string) {
  if (!("serviceWorker" in navigator)) return;
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    const notifications = (await registration?.getNotifications()) ?? [];
    for (const notification of notifications) {
      if (notification.data?.url === `/chat/${chatId}`) notification.close();
    }
  } catch {
    // No service worker / not allowed — nothing to tidy up.
  }
}

/**
 * Keeps the server informed while a chat is open: what has been read
 * (unread badges, app icon number) and whether it's in view right now (no
 * push for messages you're watching arrive).
 *
 * One RPC per change plus a heartbeat every 20 s while in view. Leaving
 * (tab hidden, app backgrounded, chat closed) is sent with fetch keepalive,
 * so it still goes out while the page is being suspended — otherwise pushes
 * would stay muted until the server window expires.
 *
 * Returns noteIncoming(), to be called when a message from the partner
 * arrives while the chat is open.
 */
export function useChatReadState(chatId: string) {
  const accessTokenRef = useRef<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  const markRead = useCallback(
    async (viewing: boolean) => {
      if (viewing) {
        noteChatRead(chatId);
        void closeChatNotifications(chatId);
      }
      const supabase = createClient();
      // Also keeps the cached token fresh for the keepalive request below.
      const { data } = await supabase.auth.getSession();
      accessTokenRef.current = data.session?.access_token ?? null;
      if (!accessTokenRef.current) return;
      const { data: unreadTotal, error } = await supabase.rpc("mark_chat_read", {
        p_chat_id: chatId,
        p_viewing: viewing,
      });
      if (error) {
        console.error("Could not mark chat as read:", error.message);
        return;
      }
      // Keeps the app icon number right on phones too, where no chat list
      // is mounted next to the chat.
      if (typeof unreadTotal === "number") showAppBadge(unreadTotal);
    },
    [chatId]
  );

  const sendLeave = useCallback(() => {
    const token = accessTokenRef.current;
    if (!token) return;
    // Plain fetch instead of supabase-js: only fetch() can outlive the page.
    void fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/mark_chat_read`, {
      method: "POST",
      keepalive: true,
      headers: {
        apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "Content-Profile": "pigeon",
      },
      body: JSON.stringify({ p_chat_id: chatId, p_viewing: false }),
    }).catch(() => {
      // Worst case the server's 45 s window runs out on its own.
    });
  }, [chatId]);

  useEffect(() => {
    let heartbeat: ReturnType<typeof setInterval> | undefined;

    function start() {
      if (heartbeat) return;
      void markRead(true);
      heartbeat = setInterval(() => void markRead(true), HEARTBEAT_MS);
    }
    function stop() {
      if (!heartbeat) return;
      clearInterval(heartbeat);
      heartbeat = undefined;
      sendLeave();
    }
    function update() {
      if (isChatInView()) start();
      else stop();
    }

    update();
    document.addEventListener("visibilitychange", update);
    window.addEventListener("focus", update);
    window.addEventListener("blur", update);
    window.addEventListener("pagehide", stop);

    return () => {
      document.removeEventListener("visibilitychange", update);
      window.removeEventListener("focus", update);
      window.removeEventListener("blur", update);
      window.removeEventListener("pagehide", stop);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      stop();
    };
  }, [markRead, sendLeave]);

  const noteIncoming = useCallback(() => {
    if (!isChatInView()) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => void markRead(true), MARK_READ_DEBOUNCE_MS);
  }, [markRead]);

  return { noteIncoming };
}
