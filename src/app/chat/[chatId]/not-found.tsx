import Link from "next/link";
import { getT } from "@/lib/i18n/server";

/**
 * notFound() from page.tsx: the chat doesn't exist or I'm not in it.
 * Rendered inside the chat layout, so on wide screens the chat list stays
 * right next to it.
 */
export default async function ChatNotFound() {
  const t = await getT();
  return (
    <main className="flex h-[100dvh] flex-col items-center justify-center gap-4 px-6 text-center">
      <span className="text-4xl">🕊️</span>
      <h1 className="text-lg font-semibold">{t("chatMisc.notFound.title")}</h1>
      <p className="max-w-sm text-sm text-neutral-500 dark:text-night-muted">
        {t("chatMisc.notFound.body")}
      </p>
      <Link href="/" className="rounded-full bg-accent px-4 py-2 text-sm text-on-accent">
        {t("chatMisc.notFound.back")}
      </Link>
    </main>
  );
}
