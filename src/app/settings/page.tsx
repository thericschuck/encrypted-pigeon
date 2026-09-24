import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser, getServerSupabase } from "@/lib/auth/current-user";
import { MEMBER_PROFILE_COLUMNS, type MemberProfile } from "@/lib/profile";
import { PushSettings } from "@/components/settings/push-settings";
import { ProfileSettings } from "@/components/settings/profile-settings";
import { SessionWatcher } from "@/components/auth/session-watcher";
import { ThemeSync } from "@/components/theme-sync";
import { SignOutButton } from "@/components/settings/sign-out-button";
import { SoundSettings } from "@/components/settings/sound-settings";
import { InstallAppSettings } from "@/components/settings/install-app-settings";
import { parseNotificationPrefs } from "@/lib/push/notification-prefs";

export default async function SettingsPage() {
  const [supabase, user] = await Promise.all([getServerSupabase(), getCurrentUser()]);

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select(`${MEMBER_PROFILE_COLUMNS}, notification_prefs`)
    .eq("id", user.id)
    .maybeSingle();

  // No profile = not a member (see lib/auth/bootstrap.ts); the dashboard
  // handles that case (signs out with an explanation).
  if (!profile) {
    redirect("/");
  }

  return (
    <main className="mx-auto flex min-h-[100dvh] max-w-md flex-col gap-4 px-4 pb-8 pt-[max(2rem,env(safe-area-inset-top))]">
      <SessionWatcher />
      <ThemeSync
        theme={(profile as MemberProfile).theme}
        accent={(profile as MemberProfile).accent_color}
      />
      <div className="flex items-center gap-3">
        <Link
          href="/"
          aria-label="Zurück"
          className="text-neutral-400 hover:text-neutral-600 dark:text-night-muted dark:hover:text-night-text"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            className="h-5 w-5"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <h1 className="text-lg font-semibold">Einstellungen</h1>
      </div>

      <ProfileSettings profile={profile as MemberProfile} />
      <PushSettings
        userId={user.id}
        initialPrefs={parseNotificationPrefs(profile.notification_prefs)}
      />
      <SoundSettings />
      <InstallAppSettings />

      <div className="mt-2">
        <SignOutButton />
      </div>
    </main>
  );
}
