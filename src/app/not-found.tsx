import Link from "next/link";

/** Any URL that doesn't exist — instead of Next's bare "404 | This page could not be found". */
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-[100dvh] max-w-sm flex-col items-center justify-center gap-4 px-6 text-center">
      <span className="text-4xl">🕊️</span>
      <h1 className="text-lg font-semibold">Seite nicht gefunden</h1>
      <p className="text-sm text-neutral-500 dark:text-night-muted">
        Hier ist keine Taube gelandet. Die Adresse gibt es nicht (mehr).
      </p>
      <Link href="/" className="rounded-full bg-accent px-4 py-2 text-sm text-on-accent">
        Zu deinen Chats
      </Link>
    </main>
  );
}
