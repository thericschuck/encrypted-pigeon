import type { ChatListItem } from "@/lib/chat/chat-overview";

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

/** Server list + everything seen since, newest activity first. */
export function withLatestActivity(chats: ChatListItem[]): ChatListItem[] {
  return sortByActivity(
    chats.map((chat) => {
      const seen = latestByChat.get(chat.chatId);
      return seen && isNewer(seen, chat.lastMessage) ? { ...chat, lastMessage: seen } : chat;
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
