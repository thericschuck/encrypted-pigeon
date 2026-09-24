import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
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
import { ChatList } from "@/components/dashboard/chat-list";
import { ChatListLiveRefresh } from "@/components/dashboard/chat-list-live-refresh";

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
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email) {
    redirect("/login");
  }

  // Also self-heals a member whose profile/home chat is missing.
  const membership = await ensureMembership({ id: user.id, email: user.email });
  if (membership.status === "not_invited") {
    redirect("/auth/signout?error=not_invited");
  }

  const isAdmin = isAdminEmail(user.email);
  const [overview, pendingInvites] = await Promise.all([
    loadChatOverview(supabase, user.id),
    isAdmin ? loadPendingInvites() : Promise.resolve([]),
  ]);
  const { me } = overview;

  return (
    <main className="mx-auto flex min-h-[100dvh] w-full max-w-xl flex-col gap-6 px-4 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[max(1.5rem,env(safe-area-inset-top))]">
      <SessionWatcher />
      <ChatListLiveRefresh />
      {me && <ThemeSync theme={me.theme} />}

      <header className="flex items-center gap-3 px-3">
        <Avatar profile={me} size="md" />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-semibold">Hallo, {displayNameOf(me)} 👋</h1>
          <p className="truncate text-xs text-neutral-500 dark:text-night-muted">
            🕊️ {pigeonNameOf(me)} wartet auf ihren nächsten Brief.
          </p>
        </div>
        <Link
          href="/settings"
          aria-label="Einstellungen"
          className="flex-shrink-0 rounded-full p-2 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600 dark:text-night-muted dark:hover:bg-night-raised dark:hover:text-night-text"
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

      <ChatList chats={overview.chats} membersWithoutChat={overview.membersWithoutChat} />

      {isAdmin && (
        <section className="flex flex-col gap-3 rounded-2xl border border-neutral-200 p-4 dark:border-night-border dark:bg-night-surface">
          <div>
            <h2 className="text-sm font-semibold">Freund einladen</h2>
            <p className="mt-0.5 text-xs text-neutral-500 dark:text-night-muted">
              Schickt einen Anmeldelink. Nur eingeladene E-Mails können Encrypted Pigeon nutzen —
              und danach mit allen aus der Gruppe schreiben.
            </p>
          </div>
          <MagicLinkForm action={inviteUser} submitLabel="Einladen" pendingLabel="Wird versendet..." />
          {pendingInvites.length > 0 && (
            <div className="flex flex-col gap-1 border-t border-neutral-200 pt-3 dark:border-night-border">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-400 dark:text-night-muted">
                Offene Einladungen
              </h3>
              <ul className="flex flex-col gap-0.5 text-sm">
                {pendingInvites.map((invite) => (
                  <li key={invite.email} className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate">{invite.email}</span>
                    <span className="flex-shrink-0 text-xs text-neutral-400 dark:text-night-muted">
                      seit {new Date(invite.created_at).toLocaleDateString("de-DE")}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}
    </main>
  );
}
