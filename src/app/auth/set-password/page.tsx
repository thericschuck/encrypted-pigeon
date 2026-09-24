import { redirect } from "next/navigation";
import { getCurrentUser, getServerSupabase } from "@/lib/auth/current-user";
import { SetPasswordForm } from "./set-password-form";

interface SetPasswordPageProps {
  searchParams: { next?: string };
}

// Only same-site paths — never bounce to another origin via ?next=.
function safeNext(next: string | undefined): string {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

/**
 * Where invite and password-reset links end up (via /auth/callback, which
 * has already signed the person in): choose a password — and, on first
 * visit, a display name — so the password login works from now on.
 */
export default async function SetPasswordPage({ searchParams }: SetPasswordPageProps) {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login?error=auth_failed");
  }

  const supabase = await getServerSupabase();
  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", user.id)
    .maybeSingle();

  return (
    <main className="mx-auto flex min-h-[100dvh] max-w-sm flex-col justify-center gap-6 px-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">🐦 Willkommen bei Encrypted Pigeon</h1>
        <p className="text-sm text-neutral-500 dark:text-night-muted">
          Leg noch fest, wie du heißt und mit welchem Passwort du dich künftig anmeldest.
        </p>
      </div>
      <SetPasswordForm
        email={user.email}
        initialDisplayName={profile?.display_name ?? ""}
        next={safeNext(searchParams.next)}
      />
    </main>
  );
}
