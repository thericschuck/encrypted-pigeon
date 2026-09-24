"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ensureMembership, type MembershipResult } from "@/lib/auth/bootstrap";

/**
 * Runs after auth-callback-handler.tsx has established a session client-side
 * (via exchangeCodeForSession or setSession) — those write the session to
 * cookies, so this server action's createClient() picks it up here to do the
 * privileged bootstrap + redirect.
 */
export async function completeAuthCallback({ setPassword }: { setPassword: boolean }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email) {
    redirect("/login?error=auth_failed");
  }

  // redirect() throws, so it must stay outside the try.
  let membership: MembershipResult | null = null;
  try {
    membership = await ensureMembership({ id: user.id, email: user.email });
  } catch (error) {
    console.error("Membership check failed:", error);
  }
  if (!membership) {
    redirect("/login?error=network");
  }

  if (membership.status === "not_invited") {
    await supabase.auth.signOut();
    redirect("/login?error=not_invited");
  }

  // A freshly invited friend lands straight in the chat with whoever
  // invited them; everyone else on the dashboard.
  const destination = membership.homeChatId ? `/chat/${membership.homeChatId}` : "/";

  // Invite / reset links: choose a password (and name) first, so the
  // account can be used with the password login from now on.
  if (setPassword) {
    redirect(`/auth/set-password?next=${encodeURIComponent(destination)}`);
  }
  redirect(destination);
}
