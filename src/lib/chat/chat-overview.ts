import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, MessageKind } from "@/lib/supabase/types";
import { MEMBER_PROFILE_COLUMNS, type MemberProfile } from "@/lib/profile";
import { sortByActivity } from "@/lib/chat/chat-list-store";
import { loadSchedules, type Schedule } from "@/lib/schedule/schedule";

type PigeonClient = SupabaseClient<Database, "pigeon">;

export interface ChatListItem {
  chatId: string;
  partner: MemberProfile;
  lastMessage: {
    preview: string;
    kind: MessageKind;
    createdAt: string;
    fromMe: boolean;
  } | null;
  /** message_ids of pigeon letters to me still in the air in this chat. */
  incomingLetterIds: string[];
  /** Messages from the partner I haven't seen yet (landed letters included). */
  unreadCount: number;
  /** The partner's Wochenplan, if visible to me (availability dot). */
  schedule: Schedule | null;
}

export interface ChatOverview {
  me: MemberProfile | null;
  chats: ChatListItem[];
  /** Members I don't have a chat with yet ("Neue Unterhaltung"). */
  membersWithoutChat: MemberProfile[];
}

export function previewOf(m: {
  content: string | null;
  image_url: string | null;
  audio_url: string | null;
  video_url?: string | null;
}) {
  if (m.content) return m.content;
  if (m.image_url) return "📷 Bild";
  if (m.video_url) return "🎬 Video";
  if (m.audio_url) return "🎤 Sprachnachricht";
  return "";
}

/**
 * Everything the dashboard and the chat sidebar show, in eight queries
 * regardless of chat count. Relies on RLS for scoping: members see all
 * member profiles, only their own chats, and — importantly — no content of
 * pigeon letters still in flight to them (those simply aren't returned).
 */
export async function loadChatOverview(supabase: PigeonClient, userId: string): Promise<ChatOverview> {
  const [{ data: profiles }, { data: myRows }] = await Promise.all([
    supabase.from("profiles").select(MEMBER_PROFILE_COLUMNS),
    supabase.from("chat_participants").select("chat_id").eq("user_id", userId),
  ]);

  const profileById = new Map((profiles ?? []).map((p) => [p.id, p as MemberProfile]));
  const me = profileById.get(userId) ?? null;
  const chatIds = (myRows ?? []).map((row) => row.chat_id);

  if (chatIds.length === 0) {
    return {
      me,
      chats: [],
      membersWithoutChat: Array.from(profileById.values()).filter((p) => p.id !== userId),
    };
  }

  const [{ data: otherRows }, { data: latestMessages }, { data: openFlights }, { data: unreadRows }, schedules] = await Promise.all([
    supabase.from("chat_participants").select("chat_id, user_id").in("chat_id", chatIds).neq("user_id", userId),
    // Exactly one row per chat (RLS-aware SQL function, see
    // supabase/migrations/20260924030000_latest_message_per_chat.sql).
    supabase.rpc("latest_messages_for_chats", { p_chat_ids: chatIds }),
    supabase
      .from("pigeon_flights")
      .select("chat_id, message_id")
      .in("chat_id", chatIds)
      .neq("status", "delivered")
      .neq("sender_id", userId),
    // supabase/migrations/20260926000000_unread_and_chat_presence.sql
    supabase.rpc("unread_counts_for_chats", { p_chat_ids: chatIds }),
    // RLS only returns the plans I may see (the admin's; all for the admin).
    loadSchedules(
      supabase,
      Array.from(profileById.values()).filter((p) => p.id !== userId)
    ),
  ]);

  const lastByChat = new Map((latestMessages ?? []).map((m) => [m.chat_id, m]));
  const unreadByChat = new Map((unreadRows ?? []).map((row) => [row.chat_id, row.unread]));
  const incomingByChat = new Map<string, string[]>();
  for (const f of openFlights ?? []) {
    if (!f.chat_id) continue;
    incomingByChat.set(f.chat_id, [...(incomingByChat.get(f.chat_id) ?? []), f.message_id]);
  }

  const chats: ChatListItem[] = [];
  const partnersWithChat = new Set<string>();
  for (const row of otherRows ?? []) {
    const partner = profileById.get(row.user_id);
    if (!partner) continue;
    partnersWithChat.add(partner.id);
    const last = lastByChat.get(row.chat_id);
    chats.push({
      chatId: row.chat_id,
      partner,
      lastMessage: last
        ? {
            preview: previewOf(last),
            kind: last.kind,
            createdAt: last.created_at,
            fromMe: last.sender_id === userId,
          }
        : null,
      incomingLetterIds: incomingByChat.get(row.chat_id) ?? [],
      unreadCount: unreadByChat.get(row.chat_id) ?? 0,
      schedule: schedules[partner.id] ?? null,
    });
  }

  const membersWithoutChat = Array.from(profileById.values()).filter(
    (p) => p.id !== userId && !partnersWithChat.has(p.id)
  );

  return { me, chats: sortByActivity(chats), membersWithoutChat };
}
