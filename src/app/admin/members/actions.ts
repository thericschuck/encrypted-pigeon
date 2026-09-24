"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdminEmail } from "@/lib/auth/admin-email";
import { AVATAR_BUCKET } from "@/lib/profile";
import { CHAT_IMAGE_BUCKET, CHAT_VOICE_BUCKET } from "@/lib/chat/buckets";

export type AdminActionResult = { status: "ok"; message: string } | { status: "error"; message: string };

/** Re-checked on every call: never trust that only the admin sees the button. */
async function requireAdmin(): Promise<{ id: string } | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user && isAdminEmail(user.email) ? { id: user.id } : null;
}

/**
 * Removes a member from Encrypted Pigeon: their chats (with every message,
 * flight and attachment in them — all chats are 1:1, so none of them make
 * sense without this person), their profile (cascades push subscriptions),
 * their avatar files and their invite, so they can't sign back in.
 *
 * The auth.users login itself is left alone on purpose: this project's
 * auth is shared with an unrelated older app (see lib/auth/bootstrap.ts).
 * Without a profile or invite that login no longer gets into Pigeon —
 * ensureMembership() signs it out as "not invited". Inviting the same
 * email again later works as usual.
 */
export async function deleteMember(userId: string): Promise<AdminActionResult> {
  const actor = await requireAdmin();
  if (!actor) return { status: "error", message: "Nicht berechtigt." };
  if (!userId || userId === actor.id) {
    return { status: "error", message: "Das eigene Konto kann hier nicht gelöscht werden." };
  }

  const admin = createAdminClient();
  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("id, email")
    .eq("id", userId)
    .maybeSingle();
  if (profileError) return { status: "error", message: profileError.message };
  if (!profile) return { status: "error", message: "Mitglied nicht gefunden." };

  // Everything stored in the chats that are about to go away.
  const { data: participantRows, error: participantsError } = await admin
    .from("chat_participants")
    .select("chat_id")
    .eq("user_id", userId);
  if (participantsError) return { status: "error", message: participantsError.message };
  const chatIds = (participantRows ?? []).map((row) => row.chat_id);

  const imagePaths: string[] = [];
  const voicePaths: string[] = [];
  if (chatIds.length > 0) {
    const { data: attachments, error: attachmentsError } = await admin
      .from("messages")
      .select("image_url, audio_url")
      .in("chat_id", chatIds);
    if (attachmentsError) return { status: "error", message: attachmentsError.message };
    for (const m of attachments ?? []) {
      if (m.image_url) imagePaths.push(m.image_url);
      if (m.audio_url) voicePaths.push(m.audio_url);
    }
  }
  const { data: avatarFiles } = await admin.storage.from(AVATAR_BUCKET).list(userId);
  const avatarPaths = (avatarFiles ?? []).map((file) => `${userId}/${file.name}`);

  // Database first: once that's gone, nobody can reach the files anyway,
  // so a storage hiccup below only leaves orphaned files, never a
  // half-deleted member.
  if (chatIds.length > 0) {
    const { error } = await admin.from("chats").delete().in("id", chatIds);
    if (error) return { status: "error", message: `Chats konnten nicht gelöscht werden: ${error.message}` };
  }
  const { error: deleteProfileError } = await admin.from("profiles").delete().eq("id", userId);
  if (deleteProfileError) {
    return { status: "error", message: `Profil konnte nicht gelöscht werden: ${deleteProfileError.message}` };
  }
  await admin.from("invites").delete().eq("email", profile.email.toLowerCase());

  const storageFailures: string[] = [];
  for (const [bucket, paths] of [
    [CHAT_IMAGE_BUCKET, imagePaths],
    [CHAT_VOICE_BUCKET, voicePaths],
    [AVATAR_BUCKET, avatarPaths],
  ] as const) {
    if (paths.length === 0) continue;
    const { error } = await admin.storage.from(bucket).remove([...paths]);
    if (error) storageFailures.push(bucket);
  }
  if (storageFailures.length > 0) {
    console.error("deleteMember: storage cleanup failed for", storageFailures);
  }

  revalidatePath("/");
  return {
    status: "ok",
    message:
      storageFailures.length > 0
        ? `${profile.email} gelöscht (einige Dateien konnten nicht entfernt werden).`
        : `${profile.email} gelöscht.`,
  };
}

/** Withdraws an invite that hasn't been accepted yet. */
export async function withdrawInvite(email: string): Promise<AdminActionResult> {
  const actor = await requireAdmin();
  if (!actor) return { status: "error", message: "Nicht berechtigt." };

  const admin = createAdminClient();
  const { error } = await admin
    .from("invites")
    .delete()
    .eq("email", email.toLowerCase())
    .is("accepted_at", null);
  if (error) return { status: "error", message: error.message };

  revalidatePath("/");
  return { status: "ok", message: `Einladung für ${email} zurückgezogen.` };
}
