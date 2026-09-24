import { MagicLinkForm } from "@/components/magic-link-form";
import { PasswordLoginForm } from "@/components/password-login-form";
import { NETWORK_ERROR_MESSAGE } from "@/lib/supabase/resilient-fetch";
import { sendMagicLink, signInWithPassword } from "./actions";

// ?error=... values set by redirects elsewhere in the app (page.tsx,
// auth/callback/actions.ts, lib/auth/session-expiry.ts).
const ERROR_MESSAGES: Record<string, string> = {
  session_expired: "Deine Sitzung ist abgelaufen. Bitte melde dich erneut an.",
  auth_failed: "Die Anmeldung hat nicht geklappt. Bitte versuche es erneut.",
  not_invited:
    "Für diese E-Mail gibt es keine Einladung. Frag die Person, die Encrypted Pigeon betreibt.",
  network: NETWORK_ERROR_MESSAGE,
};

interface LoginPageProps {
  searchParams: { error?: string };
}

export default function LoginPage({ searchParams }: LoginPageProps) {
  const errorMessage = searchParams.error
    ? (ERROR_MESSAGES[searchParams.error] ?? "Etwas ist schiefgelaufen. Bitte melde dich erneut an.")
    : null;

  return (
    <main className="mx-auto flex min-h-[100dvh] max-w-sm flex-col justify-center gap-6 px-6">
      <h1 className="text-2xl font-semibold">🐦 Encrypted Pigeon</h1>

      {errorMessage && (
        <p
          role="alert"
          className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200"
        >
          {errorMessage}
        </p>
      )}

      <div className="flex flex-col gap-3">
        <p className="text-sm text-neutral-500 dark:text-night-muted">Mit Passwort anmelden.</p>
        <PasswordLoginForm action={signInWithPassword} />
      </div>

      <div className="flex flex-col gap-3 border-t border-neutral-200 pt-6 dark:border-night-border">
        <p className="text-sm text-neutral-500 dark:text-night-muted">
          Oder mit Magic Link: Wir schicken dir einen Anmeldelink per E-Mail.
        </p>
        <MagicLinkForm
          action={sendMagicLink}
          submitLabel="Magic Link senden"
          pendingLabel="Wird gesendet..."
        />
      </div>
    </main>
  );
}
