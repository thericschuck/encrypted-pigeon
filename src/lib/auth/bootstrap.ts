import { createAdminClient } from "@/lib/supabase/admin";
import { getAdminEmail, isAdminEmail } from "@/lib/auth/admin-email";

interface AuthUser {
  id: string;
  email: string;
}

/**
 * Runs on first login (from the magic-link callback), and as a self-healing
 * fallback if a returning user somehow has no chat yet. Idempotent — safe to
 * call repeatedly for the same user.
 *
 * - Ensures a pigeon.profiles row exists for this auth user. Their
 *   auth.users row may predate this project (it's shared with an unrelated
 *   old project) — that's expected, not an error.
 * - For non-admin users, ensures a 1:1 chat with the admin exists.
 *
 * Uses the service-role client because a brand-new user has no rows for any
 * RLS policy to key off yet; this bootstrap step intentionally sits outside
 * the RLS model that governs ordinary app usage.
 */
export async function ensureProfileAndHomeChat(
  user: AuthUser
): Promise<{ chatId: string | null }> {
  const admin = createAdminClient();

  const { data: existingProfile } = await admin
    .from("profiles")
    .select("id")
    .eq("id", user.id)
    .maybeSingle();

  if (!existingProfile) {
    const { error } = await admin.from("profiles").insert({
      id: user.id,
      email: user.email,
    });
    if (error) throw error;
  }

  if (isAdminEmail(user.email)) {
    return { chatId: null };
  }

  const { data: adminProfile } = await admin
    .from("profiles")
    .select("id")
    .eq("email", getAdminEmail())
    .maybeSingle();

  if (!adminProfile) {
    // The admin hasn't logged in yet. Shouldn't happen in practice since
    // /admin/invite requires an admin session to send an invite in the
    // first place — but don't break this person's login over it.
    return { chatId: null };
  }

  const chatId = await findOrCreateDirectChat(admin, user.id, adminProfile.id);
  return { chatId };
}

async function findOrCreateDirectChat(
  admin: ReturnType<typeof createAdminClient>,
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
