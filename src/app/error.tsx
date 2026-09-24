"use client";

import { useEffect } from "react";
import Link from "next/link";

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
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="mx-auto flex min-h-[100dvh] max-w-sm flex-col items-center justify-center gap-4 px-6 text-center">
      <span className="text-4xl">🪶</span>
      <h1 className="text-lg font-semibold">Da ist etwas schiefgelaufen</h1>
      <p className="text-sm text-neutral-500 dark:text-night-muted">
        Die Taube hat sich verflogen. Prüfe deine Verbindung und versuche es noch einmal.
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={reset}
          className="rounded-full bg-neutral-900 px-4 py-2 text-sm text-white dark:bg-night-accent dark:text-night-bg"
        >
          Erneut versuchen
        </button>
        <Link
          href="/"
          className="rounded-full border border-neutral-300 px-4 py-2 text-sm dark:border-night-border"
        >
          Zur Startseite
        </Link>
      </div>
    </main>
  );
}
