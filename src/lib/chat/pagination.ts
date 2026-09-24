/**
 * Messages per page in a chat: the chat page server-renders the newest
 * page, <ChatRoom /> loads older ones page by page when scrolling up — so
 * opening a chat costs the same no matter how long its history is.
 */
export const CHAT_PAGE_SIZE = 50;
