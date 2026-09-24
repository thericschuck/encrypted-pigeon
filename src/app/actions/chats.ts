"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { findOrCreateDirectChat } from "@/lib/auth/bootstrap";

/**
 * "Neue Unterhaltung" on the dashboard. Chats and memberships aren't
 * writable through RLS (so nobody can add themselves to someone else's
 * chat), which is why this goes through the service-role client — after
 * checking that both sides really are members.
 */
export async function startChat(formData: FormData) {
  const otherUserId = String(formData.get("userId") ?? "");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  if (!otherUserId || otherUserId === user.id) redirect("/");

  const admin = createAdminClient();
  const { data: members } = await admin
    .from("profiles")
    .select("id")
    .in("id", [user.id, otherUserId]);
  if ((members ?? []).length !== 2) redirect("/");

  const chatId = await findOrCreateDirectChat(admin, user.id, otherUserId);
  redirect(`/chat/${chatId}`);
}
