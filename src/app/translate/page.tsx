import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser, getServerSupabase } from "@/lib/auth/current-user";
import { isAdminEmail } from "@/lib/auth/admin-email";
import { MEMBER_PROFILE_COLUMNS, type MemberProfile } from "@/lib/profile";
import { usage } from "@/lib/translate/deepl";
import { loadHistory } from "./actions";
import { SessionWatcher } from "@/components/auth/session-watcher";
import { ThemeSync } from "@/components/theme-sync";
import { Translator } from "@/components/translate/translator";

export default async function TranslatePage() {
  const [supabase, user] = await Promise.all([getServerSupabase(), getCurrentUser()]);

  if (!user) {
    redirect("/login");
  }
  // Admin only for now: for everyone else the page doesn't exist.
  if (!isAdminEmail(user.email)) {
    notFound();
  }

  const configured = !!process.env.DEEPL_API_KEY;
  const [{ data: profile }, initialUsage, initialHistory] = await Promise.all([
    supabase.from("profiles").select(MEMBER_PROFILE_COLUMNS).eq("id", user.id).maybeSingle(),
    configured ? usage() : Promise.resolve(null),
    loadHistory(),
  ]);

  return (
    <main className="mx-auto flex min-h-[100dvh] w-full max-w-3xl flex-col gap-4 px-4 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[max(2rem,env(safe-area-inset-top))]">
      <SessionWatcher />
      {profile && (
        <ThemeSync theme={(profile as MemberProfile).theme} accent={(profile as MemberProfile).accent_color} />
      )}
      <div className="flex items-center gap-3">
        <Link
          href="/"
          aria-label="Zurück"
          className="text-neutral-400 hover:text-neutral-600 dark:text-night-muted dark:hover:text-night-text"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <h1 className="text-lg font-semibold">Übersetzer</h1>
      </div>

      {configured ? (
        <Translator initialUsage={initialUsage} initialHistory={initialHistory} />
      ) : (
        <p className="rounded-xl border border-dashed border-neutral-300 p-4 text-sm text-neutral-500 dark:border-night-border dark:text-night-muted">
          Der Übersetzer ist noch nicht eingerichtet: <code>DEEPL_API_KEY</code> fehlt in den
          Umgebungsvariablen (lokal in <code>.env.local</code>, live in Vercel).
        </p>
      )}
    </main>
  );
}
