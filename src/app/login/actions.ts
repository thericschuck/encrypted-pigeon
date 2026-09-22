"use server";

import { createClient } from "@/lib/supabase/server";
import { ensureProfileAndHomeChat } from "@/lib/auth/bootstrap";
import { isAdminEmail } from "@/lib/auth/admin-email";
import type { MagicLinkState } from "@/lib/auth/magic-link-state";

export async function sendMagicLink(
  _prevState: MagicLinkState,
  formData: FormData
): Promise<MagicLinkState> {
  const email = String(formData.get("email") ?? "").trim();

  if (!email) {
    return { status: "error", message: "Bitte eine E-Mail-Adresse eingeben." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/auth/callback`,
    },
  });

  if (error) {
    return { status: "error", message: error.message };
  }

  return {
    status: "sent",
    message: `Magic Link an ${email} verschickt. Bitte E-Mails prüfen.`,
  };
}

export async function signInWithPassword(
  _prevState: MagicLinkState,
  formData: FormData
): Promise<MagicLinkState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { status: "error", message: "E-Mail und Passwort erforderlich." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error || !data.user?.email) {
    return {
      status: "error",
      message: error?.message ?? "Anmeldung fehlgeschlagen.",
    };
  }

  const user = { id: data.user.id, email: data.user.email };

  // Redirecting via client-side router.push() (see PasswordLoginForm)
  // instead of calling next/navigation's redirect() here works around a
  // Next.js bug where a useFormState-bound action that redirects can leave
  // `state` undefined on the next render:
  // https://github.com/vercel/next.js/issues/68549
  if (isAdminEmail(user.email)) {
    await ensureProfileAndHomeChat(user);
    return { status: "redirect", message: "", redirectTo: "/admin/invite" };
  }

  const { chatId } = await ensureProfileAndHomeChat(user);
  if (!chatId) {
    return { status: "error", message: "Kein Chat gefunden." };
  }
  return { status: "redirect", message: "", redirectTo: `/chat/${chatId}` };
}
