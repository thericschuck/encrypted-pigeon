import type { ChatListItem } from "@/lib/chat/chat-overview";
import type { MemberProfile } from "@/lib/profile";

type LastMessage = NonNullable<ChatListItem["lastMessage"]>;

/**
 * Newest activity per chat seen by this browser tab, kept in module state
 * so it survives client-side navigation.
 *
 * The chat list is server-rendered, and Next's client router cache may
 * hand back a snapshot up to 30s old when navigating back to it — without
 * this, a message just sent or received in a chat could be missing from
 * the list until the next server render. <LiveChatList /> and <ChatRoom />
 * both report here; <LiveChatList /> merges it over whatever the server
 * sent. Nothing is fetched for it.
 */
const latestByChat = new Map<string, LastMessage>();

function isNewer(candidate: LastMessage, current: LastMessage | null | undefined) {
  return !current || Date.parse(candidate.createdAt) > Date.parse(current.createdAt);
}

export function noteChatActivity(chatId: string, message: LastMessage) {
  if (isNewer(message, latestByChat.get(chatId))) latestByChat.set(chatId, message);
}

/**
 * When this tab last saw each chat (i.e. <ChatRoom /> marked it read). A
 * list snapshot from before that — the router cache, a remembered list —
 * must not bring the unread badge back.
 */
const readAtByChat = new Map<string, number>();
const readListeners = new Set<(chatId: string) => void>();

export function noteChatRead(chatId: string) {
  readAtByChat.set(chatId, Date.now());
  readListeners.forEach((listener) => listener(chatId));
}

/** Called whenever a chat gets marked read in this tab. Returns the unsubscribe. */
export function onChatRead(listener: (chatId: string) => void): () => void {
  readListeners.add(listener);
  return () => readListeners.delete(listener);
}

// The most recent full list any <LiveChatList /> showed, so the chat
// sidebar can start from it when coming from the dashboard.
let rememberedList: {
  chats: ChatListItem[];
  membersWithoutChat: MemberProfile[];
  at: number;
} | null = null;

export function rememberChatList(chats: ChatListItem[], membersWithoutChat: MemberProfile[]) {
  rememberedList = { chats, membersWithoutChat, at: Date.now() };
}

/** The remembered list if it's younger than maxAgeMs (and merged with activity since). */
export function recallChatList(maxAgeMs: number) {
  if (!rememberedList || Date.now() - rememberedList.at > maxAgeMs) return null;
  return {
    chats: withLatestActivity(rememberedList.chats),
    membersWithoutChat: rememberedList.membersWithoutChat,
  };
}

/** Server list + everything seen since, newest activity first. */
export function withLatestActivity(chats: ChatListItem[]): ChatListItem[] {
  return sortByActivity(
    chats.map((chat) => {
      const seen = latestByChat.get(chat.chatId);
      const next = seen && isNewer(seen, chat.lastMessage) ? { ...chat, lastMessage: seen } : chat;
      const readAt = readAtByChat.get(chat.chatId);
      // Read in this tab after the newest message the list knows of: seen.
      if (next.unreadCount > 0 && readAt && next.lastMessage && Date.parse(next.lastMessage.createdAt) <= readAt) {
        return { ...next, unreadCount: 0 };
      }
      return next;
    })
  );
}

/** Most recent activity first; chats without messages at the end. */
export function sortByActivity(chats: ChatListItem[]): ChatListItem[] {
  return [...chats].sort((a, b) => {
    const at = a.lastMessage ? Date.parse(a.lastMessage.createdAt) : 0;
    const bt = b.lastMessage ? Date.parse(b.lastMessage.createdAt) : 0;
    return bt - at;
  });
}
