import Link from "next/link";

/**
 * notFound() from page.tsx: the chat doesn't exist or I'm not in it.
 * Rendered inside the chat layout, so on wide screens the chat list stays
 * right next to it.
 */
export default function ChatNotFound() {
  return (
    <main className="flex h-[100dvh] flex-col items-center justify-center gap-4 px-6 text-center">
      <span className="text-4xl">🕊️</span>
      <h1 className="text-lg font-semibold">Chat nicht gefunden</h1>
      <p className="max-w-sm text-sm text-neutral-500 dark:text-night-muted">
        Diesen Chat gibt es nicht (mehr), oder du bist nicht Teil davon.
      </p>
      <Link href="/" className="rounded-full bg-accent px-4 py-2 text-sm text-on-accent">
        Zu deinen Chats
      </Link>
    </main>
  );
}
