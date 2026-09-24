"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { findOrCreateDirectChat } from "@/lib/auth/bootstrap";
import { isAdminEmail } from "@/lib/auth/admin-email";

/**
 * "Neue Unterhaltung" on the dashboard — admin only: invited friends talk
 * to the admin (their home chat) and don't get to reach out to other
 * members. (They don't see other members either, see the profiles RLS in
 * 20260925020000_profiles_visible_to_chat_partners.sql.) Chats and memberships aren't
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
  if (!isAdminEmail(user.email)) redirect("/");

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
