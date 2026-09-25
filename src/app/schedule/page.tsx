import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser, getServerSupabase } from "@/lib/auth/current-user";
import { MEMBER_PROFILE_COLUMNS, type MemberProfile } from "@/lib/profile";
import { loadSchedules } from "@/lib/schedule/schedule";
import { SessionWatcher } from "@/components/auth/session-watcher";
import { ThemeSync } from "@/components/theme-sync";
import { ScheduleEditor } from "@/components/schedule/schedule-editor";

export default async function MySchedulePage() {
  const [supabase, user] = await Promise.all([getServerSupabase(), getCurrentUser()]);

  if (!user) {
    redirect("/login");
  }

  const { data } = await supabase
    .from("profiles")
    .select(`${MEMBER_PROFILE_COLUMNS}, is_admin`)
    .eq("id", user.id)
    .maybeSingle();
  // No profile = not a member; the dashboard handles that.
  if (!data) {
    redirect("/");
  }
  const profile = data as MemberProfile & { is_admin: boolean };
  const schedules = await loadSchedules(supabase, [profile]);
  const schedule = schedules[user.id] ?? {
    ownerId: user.id,
    timezone: profile.timezone,
    blocks: [],
    exceptions: [],
  };

  return (
    <main className="mx-auto flex min-h-[100dvh] w-full max-w-xl flex-col gap-4 px-4 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[max(1.5rem,env(safe-area-inset-top))]">
      <SessionWatcher />
      <ThemeSync theme={profile.theme} accent={profile.accent_color} />
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
        <h1 className="text-lg font-semibold">Mein Wochenplan</h1>
      </div>
      <ScheduleEditor
        userId={user.id}
        initialSchedule={schedule}
        initialPublic={profile.schedule_public}
        isAdmin={profile.is_admin}
      />
    </main>
  );
}
