import Link from "next/link";
import { getT } from "@/lib/i18n/server";

/** Any URL that doesn't exist — instead of Next's bare "404 | This page could not be found". */
export default async function NotFound() {
  const t = await getT();
  return (
    <main className="mx-auto flex min-h-[100dvh] max-w-sm flex-col items-center justify-center gap-4 px-6 text-center">
      <span className="text-4xl">🕊️</span>
      <h1 className="text-lg font-semibold">{t("system.notFound.title")}</h1>
      <p className="text-sm text-neutral-500 dark:text-night-muted">
        {t("system.notFound.body")}
      </p>
      <Link href="/" className="rounded-full bg-accent px-4 py-2 text-sm text-on-accent">
        {t("system.notFound.toChats")}
      </Link>
    </main>
  );
}
