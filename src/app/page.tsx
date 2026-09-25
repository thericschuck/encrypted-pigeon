import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser, getServerSupabase } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { ensureMembership } from "@/lib/auth/bootstrap";
import { isAdminEmail } from "@/lib/auth/admin-email";
import { loadChatOverview } from "@/lib/chat/chat-overview";
import { displayNameOf, pigeonNameOf } from "@/lib/profile";
import { inviteUser } from "@/app/admin/invite/actions";
import { MagicLinkForm } from "@/components/magic-link-form";
import { SessionWatcher } from "@/components/auth/session-watcher";
import { ThemeSync } from "@/components/theme-sync";
import { Avatar } from "@/components/ui/avatar";
import { LiveChatList } from "@/components/dashboard/live-chat-list";
import { MemberManagement } from "@/components/dashboard/member-management";

async function loadPendingInvites() {
  // pigeon.invites is service-role only (not readable through RLS at all).
  const admin = createAdminClient();
  const { data } = await admin
    .from("invites")
    .select("email, created_at")
    .is("accepted_at", null)
    .order("created_at", { ascending: false });
  return data ?? [];
}

export default async function DashboardPage() {
  const [supabase, user] = await Promise.all([getServerSupabase(), getCurrentUser()]);

  if (!user?.email) {
    redirect("/login");
  }

  const isAdmin = isAdminEmail(user.email);
  const [initialOverview, pendingInvites] = await Promise.all([
    loadChatOverview(supabase, user.id),
    isAdmin ? loadPendingInvites() : Promise.resolve([]),
  ]);
  let overview = initialOverview;

  // Every login already ran ensureMembership. Here it's only the
  // self-heal for a member whose profile or home chat is missing — so it
  // runs (and costs its service-role queries) only when that's the case.
  if (!overview.me || (!isAdmin && overview.chats.length === 0)) {
    const membership = await ensureMembership({ id: user.id, email: user.email });
    if (membership.status === "not_invited") {
      redirect("/auth/signout?error=not_invited");
    }
    overview = await loadChatOverview(supabase, user.id);
  }
  const { me } = overview;

  return (
    <main className="mx-auto flex min-h-[100dvh] w-full max-w-xl flex-col gap-6 px-4 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[max(1.5rem,env(safe-area-inset-top))]">
      <SessionWatcher />
      {me && <ThemeSync theme={me.theme} accent={me.accent_color} />}

      <header className="flex items-center gap-3 px-3">
        <Avatar profile={me} size="md" />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-semibold">Hallo, {displayNameOf(me)} 👋</h1>
          <p className="truncate text-xs text-neutral-500 dark:text-night-muted">
            🕊️ {pigeonNameOf(me)} wartet auf ihren nächsten Brief.
          </p>
        </div>
        {isAdmin && (
          <Link
            href="/translate"
            aria-label="Übersetzer"
            title="Übersetzer"
            className="flex-shrink-0 rounded-full p-2 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600 dark:text-night-muted dark:hover:bg-night-raised dark:hover:text-night-text"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 5h12M9 3v2m1.05 9.5A18.02 18.02 0 0 1 6.41 9M12.75 5C11.78 10.77 8.07 15.61 3 18.13M12 21l5.25-11.25L22.5 21m-9-3h7.5" />
            </svg>
          </Link>
        )}
        <Link
          href="/schedule"
          aria-label="Mein Wochenplan"
          className="flex-shrink-0 rounded-full p-2 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600 dark:text-night-muted dark:hover:bg-night-raised dark:hover:text-night-text"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5">
            <rect x="3" y="5" width="18" height="16" rx="2" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M16 3v4M8 3v4M3 10h18M8 14h2M14 14h2M8 17h2" />
          </svg>
        </Link>
        <Link
          href="/settings"
          aria-label="Einstellungen"
          className="-ml-2 flex-shrink-0 rounded-full p-2 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600 dark:text-night-muted dark:hover:bg-night-raised dark:hover:text-night-text"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
            />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </Link>
      </header>

      <LiveChatList userId={user.id} chats={overview.chats} membersWithoutChat={overview.membersWithoutChat} />

      {isAdmin && (
        <section className="flex flex-col gap-3 rounded-2xl border border-neutral-200 p-4 dark:border-night-border dark:bg-night-surface">
          <div>
            <h2 className="text-sm font-semibold">Freund einladen</h2>
            <p className="mt-0.5 text-xs text-neutral-500 dark:text-night-muted">
              Schickt einen Anmeldelink. Nur eingeladene E-Mails können Encrypted Pigeon nutzen —
              und schreiben dann mit dir. Andere Mitglieder sehen sie nicht.
            </p>
          </div>
          <MagicLinkForm action={inviteUser} submitLabel="Einladen" pendingLabel="Wird versendet..." />
        </section>
      )}

      {isAdmin && (
        <MemberManagement
          members={Array.from(
            new Map(
              [...overview.chats.map((chat) => chat.partner), ...overview.membersWithoutChat].map((m) => [m.id, m])
            ).values()
          ).sort((a, b) => a.email.localeCompare(b.email))}
          pendingInvites={pendingInvites}
        />
      )}
    </main>
  );
}
