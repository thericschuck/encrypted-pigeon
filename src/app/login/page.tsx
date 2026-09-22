import { MagicLinkForm } from "@/components/magic-link-form";
import { PasswordLoginForm } from "@/components/password-login-form";
import { sendMagicLink, signInWithPassword } from "./actions";

export default function LoginPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-6">
      <h1 className="text-2xl font-semibold">🐦 Encrypted Pigeon</h1>

      <div className="flex flex-col gap-3">
        <p className="text-sm text-neutral-500">Mit Passwort anmelden.</p>
        <PasswordLoginForm action={signInWithPassword} />
      </div>

      <div className="flex flex-col gap-3 border-t border-neutral-200 pt-6">
        <p className="text-sm text-neutral-500">
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
