import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser, getServerSupabase } from "@/lib/auth/current-user";
import { MEMBER_PROFILE_COLUMNS, displayNameOf, type MemberProfile } from "@/lib/profile";
import { loadSchedules } from "@/lib/schedule/schedule";
import { SessionWatcher } from "@/components/auth/session-watcher";
import { ThemeSync } from "@/components/theme-sync";
import { Avatar } from "@/components/ui/avatar";
import { ScheduleView } from "@/components/schedule/schedule-view";

interface SchedulePageProps {
  params: { userId: string };
}

export default async function MemberSchedulePage({ params }: SchedulePageProps) {
  const [supabase, user] = await Promise.all([getServerSupabase(), getCurrentUser()]);

  if (!user) {
    redirect("/login");
  }
  if (params.userId === user.id) {
    redirect("/schedule");
  }

  const { data: profiles, error } = await supabase
    .from("profiles")
    .select(MEMBER_PROFILE_COLUMNS)
    .in("id", [user.id, params.userId]);
  // 22P02 = not even a uuid, a genuine 404.
  if (error && error.code !== "22P02") {
    throw new Error(`Wochenplan konnte nicht geladen werden: ${error.message}`);
  }
  const me = profiles?.find((p) => p.id === user.id) as MemberProfile | undefined;
  const owner = profiles?.find((p) => p.id === params.userId) as MemberProfile | undefined;
  if (!me) {
    redirect("/");
  }
  // RLS: not a visible member, or their plan isn't shared with me (then
  // no rows come back) — both look the same from here.
  if (!owner) {
    notFound();
  }
  const schedule = (await loadSchedules(supabase, [owner]))[owner.id];

  return (
    <main className="mx-auto flex min-h-[100dvh] w-full max-w-xl flex-col gap-4 px-4 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[max(1.5rem,env(safe-area-inset-top))]">
      <SessionWatcher />
      <ThemeSync theme={me.theme} accent={me.accent_color} />
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
        <Avatar profile={owner} size="sm" />
        <h1 className="min-w-0 truncate text-lg font-semibold">Woche von {displayNameOf(owner)}</h1>
      </div>
      {schedule ? (
        <ScheduleView schedule={schedule} ownerName={displayNameOf(owner)} />
      ) : (
        <p className="rounded-2xl border border-neutral-200 p-4 text-sm text-neutral-600 dark:border-night-border dark:bg-night-surface dark:text-night-muted">
          {displayNameOf(owner)} hat (noch) keinen Wochenplan, den du sehen kannst.
        </p>
      )}
    </main>
  );
}
