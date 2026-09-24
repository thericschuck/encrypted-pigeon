import { createAdminClient } from "@/lib/supabase/admin";
import { getAdminEmail, isAdminEmail } from "@/lib/auth/admin-email";

interface AuthUser {
  id: string;
  email: string;
}

export type MembershipResult =
  | { status: "member"; homeChatId: string | null }
  | { status: "not_invited" };

type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * Runs on every login (password, magic link, invite link) and as a
 * self-healing check on the dashboard. Idempotent.
 *
 * A pigeon.profiles row IS membership. auth.users is shared with an
 * unrelated old project, so having a Supabase session proves nothing:
 * a profile is only created for the admin or an email on pigeon.invites
 * (written by the admin's invite action). Everyone else gets
 * "not_invited" and is signed out by the caller.
 *
 * New non-admin members also get a 1:1 chat with the admin, so the person
 * who invited them is already there on first login.
 *
 * Uses the service-role client: profiles/chats/invites are deliberately not
 * writable through RLS at all.
 */
export async function ensureMembership(user: AuthUser): Promise<MembershipResult> {
  const admin = createAdminClient();
  const email = user.email.toLowerCase();
  const isAdmin = isAdminEmail(email);

  // Lookup errors must throw, never read as "no row": a network hiccup
  // would otherwise count as "not invited" and sign a real member out.
  const { data: existingProfile, error: profileError } = await admin
    .from("profiles")
    .select("id, is_admin")
    .eq("id", user.id)
    .maybeSingle();
  if (profileError) throw profileError;

  if (!existingProfile) {
    if (!isAdmin) {
      const { data: invite, error: inviteError } = await admin
        .from("invites")
        .select("email")
        .eq("email", email)
        .maybeSingle();
      if (inviteError) throw inviteError;
      if (!invite) return { status: "not_invited" };
    }

    const { error } = await admin
      .from("profiles")
      .insert({ id: user.id, email: user.email, is_admin: isAdmin });
    // 23505: a parallel request (e.g. two tabs) created it first — fine.
    if (error && error.code !== "23505") throw error;

    await admin
      .from("invites")
      .upsert({ email, accepted_at: new Date().toISOString() }, { onConflict: "email" });
  }

  if (isAdmin) {
    // is_admin lets the database show the admin every member (profiles
    // RLS); everyone else only sees their chat partners. Kept in sync with
    // ADMIN_EMAIL here rather than hard-coded in SQL.
    if (existingProfile && !existingProfile.is_admin) {
      const { error } = await admin.from("profiles").update({ is_admin: true }).eq("id", user.id);
      if (error) throw error;
    }
    return { status: "member", homeChatId: null };
  }

  const { data: adminProfile } = await admin
    .from("profiles")
    .select("id")
    .eq("email", getAdminEmail())
    .maybeSingle();

  if (!adminProfile) return { status: "member", homeChatId: null };

  const homeChatId = await findOrCreateDirectChat(admin, user.id, adminProfile.id);
  return { status: "member", homeChatId };
}

/** Finds the 1:1 chat between two users, creating it if there is none. */
export async function findOrCreateDirectChat(
  admin: AdminClient,
  userId: string,
  otherUserId: string
): Promise<string> {
  const { data: userChats } = await admin
    .from("chat_participants")
    .select("chat_id")
    .eq("user_id", userId);

  const chatIds = (userChats ?? []).map((row) => row.chat_id);

  if (chatIds.length > 0) {
    const { data: shared } = await admin
      .from("chat_participants")
      .select("chat_id")
      .eq("user_id", otherUserId)
      .in("chat_id", chatIds)
      .limit(1);

    if (shared && shared.length > 0) {
      return shared[0].chat_id;
    }
  }

  const { data: newChat, error: chatError } = await admin
    .from("chats")
    .insert({})
    .select("id")
    .single();

  if (chatError || !newChat) {
    throw chatError ?? new Error("Failed to create chat");
  }

  const { error: participantsError } = await admin
    .from("chat_participants")
    .insert([
      { chat_id: newChat.id, user_id: userId },
      { chat_id: newChat.id, user_id: otherUserId },
    ]);

  if (participantsError) throw participantsError;

  return newChat.id;
}
