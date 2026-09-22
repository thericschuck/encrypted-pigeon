"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ensureProfileAndHomeChat } from "@/lib/auth/bootstrap";
import { isAdminEmail } from "@/lib/auth/admin-email";

/**
 * Runs after auth-callback-handler.tsx has established a session client-side
 * (via exchangeCodeForSession or setSession) — those write the session to
 * cookies, so this server action's createClient() picks it up here to do the
 * privileged bootstrap + redirect.
 */
export async function completeAuthCallback() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email) {
    redirect("/login?error=auth_failed");
  }

  const authedUser = { id: user.id, email: user.email };

  if (isAdminEmail(authedUser.email)) {
    await ensureProfileAndHomeChat(authedUser);
    redirect("/admin/invite");
  }

  const { chatId } = await ensureProfileAndHomeChat(authedUser);

  if (!chatId) {
    redirect("/login?error=no_chat");
  }

  redirect(`/chat/${chatId}`);
}
