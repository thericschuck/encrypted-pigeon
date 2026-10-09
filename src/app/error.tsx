"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useT } from "@/lib/i18n/client";

/**
 * Last-resort boundary for anything that throws during render or in a
 * Server Component (e.g. Supabase unreachable). Friendlier than Next's
 * default crash screen and offers a retry instead of a dead end.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useT();
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="mx-auto flex min-h-[100dvh] max-w-sm flex-col items-center justify-center gap-4 px-6 text-center">
      <span className="text-4xl">🪶</span>
      <h1 className="text-lg font-semibold">{t("system.error.title")}</h1>
      <p className="text-sm text-neutral-500 dark:text-night-muted">
        {t("system.error.body")}
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={reset}
          className="rounded-full bg-accent px-4 py-2 text-sm text-on-accent"
        >
          {t("system.error.retry")}
        </button>
        <Link
          href="/"
          className="rounded-full border border-neutral-300 px-4 py-2 text-sm dark:border-night-border"
        >
          {t("system.error.home")}
        </Link>
      </div>
    </main>
  );
}
