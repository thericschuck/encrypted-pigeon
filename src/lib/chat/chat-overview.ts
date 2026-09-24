import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, MessageKind } from "@/lib/supabase/types";
import { MEMBER_PROFILE_COLUMNS, type MemberProfile } from "@/lib/profile";

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
  /** A pigeon letter to me is still in the air in this chat. */
  incomingPigeon: boolean;
}

export interface ChatOverview {
  me: MemberProfile | null;
  chats: ChatListItem[];
  /** Members I don't have a chat with yet ("Neue Unterhaltung"). */
  membersWithoutChat: MemberProfile[];
}

// Enough recent rows to find the latest message of every chat in a small
// friend group without one query per chat.
const RECENT_MESSAGES_LIMIT = 300;

function previewOf(m: { content: string | null; image_url: string | null; audio_url: string | null }) {
  if (m.content) return m.content;
  if (m.image_url) return "📷 Bild";
  if (m.audio_url) return "🎤 Sprachnachricht";
  return "";
}

/**
 * Everything the dashboard and the chat sidebar show, in five queries
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

  const [{ data: otherRows }, { data: recentMessages }, { data: openFlights }] = await Promise.all([
    supabase.from("chat_participants").select("chat_id, user_id").in("chat_id", chatIds).neq("user_id", userId),
    supabase
      .from("messages")
      .select("chat_id, sender_id, kind, content, image_url, audio_url, created_at")
      .in("chat_id", chatIds)
      .order("created_at", { ascending: false })
      .limit(RECENT_MESSAGES_LIMIT),
    supabase
      .from("pigeon_flights")
      .select("chat_id, sender_id")
      .in("chat_id", chatIds)
      .neq("status", "delivered")
      .neq("sender_id", userId),
  ]);

  const lastByChat = new Map<string, NonNullable<typeof recentMessages>[number]>();
  for (const m of recentMessages ?? []) {
    if (!lastByChat.has(m.chat_id)) lastByChat.set(m.chat_id, m);
  }
  const chatsWithIncoming = new Set((openFlights ?? []).map((f) => f.chat_id));

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
      incomingPigeon: chatsWithIncoming.has(row.chat_id),
    });
  }

  // Most recent activity first; chats without messages at the end.
  chats.sort((a, b) => {
    const at = a.lastMessage ? Date.parse(a.lastMessage.createdAt) : 0;
    const bt = b.lastMessage ? Date.parse(b.lastMessage.createdAt) : 0;
    return bt - at;
  });

  const membersWithoutChat = Array.from(profileById.values()).filter(
    (p) => p.id !== userId && !partnersWithChat.has(p.id)
  );

  return { me, chats, membersWithoutChat };
}
