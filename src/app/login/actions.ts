"use server";

import { createClient } from "@/lib/supabase/server";
import { ensureMembership } from "@/lib/auth/bootstrap";
import { authCallbackUrl } from "@/lib/site-url";
import type { MagicLinkState } from "@/lib/auth/magic-link-state";
import { NETWORK_ERROR_MESSAGE, isNetworkError } from "@/lib/supabase/resilient-fetch";

const NOT_INVITED_MESSAGE =
  "Für diese E-Mail gibt es keine Einladung. Frag die Person, die Encrypted Pigeon betreibt.";

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
      emailRedirectTo: await authCallbackUrl(),
      // Never create accounts from the public login page — new people only
      // come in through an invite (admin dashboard).
      shouldCreateUser: false,
    },
  });

  if (error) {
    if (isNetworkError(error)) return { status: "error", message: NETWORK_ERROR_MESSAGE };
    // GoTrue's wording for "no such user" with shouldCreateUser: false.
    if (/signups not allowed|user not found/i.test(error.message)) {
      return { status: "error", message: NOT_INVITED_MESSAGE };
    }
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

  if (error && isNetworkError(error)) {
    return { status: "error", message: NETWORK_ERROR_MESSAGE };
  }

  if (error || !data.user?.email) {
    return {
      status: "error",
      message: error?.message ?? "Anmeldung fehlgeschlagen.",
    };
  }

  let membership;
  try {
    membership = await ensureMembership({ id: data.user.id, email: data.user.email });
  } catch (bootstrapError) {
    console.error("Membership check failed:", bootstrapError);
    return {
      status: "error",
      message: isNetworkError(bootstrapError)
        ? NETWORK_ERROR_MESSAGE
        : "Anmeldung fehlgeschlagen. Bitte nochmal versuchen.",
    };
  }
  if (membership.status === "not_invited") {
    await supabase.auth.signOut();
    return { status: "error", message: NOT_INVITED_MESSAGE };
  }

  // Redirecting via client-side router.push() (see PasswordLoginForm)
  // instead of calling next/navigation's redirect() here works around a
  // Next.js bug where a useFormState-bound action that redirects can leave
  // `state` undefined on the next render:
  // https://github.com/vercel/next.js/issues/68549
  return { status: "redirect", message: "", redirectTo: "/" };
}
