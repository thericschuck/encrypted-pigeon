import { LanguageSelect } from "@/components/language-select";
import { MagicLinkForm } from "@/components/magic-link-form";
import { PasswordLoginForm } from "@/components/password-login-form";
import { getT } from "@/lib/i18n/server";
import { sendMagicLink, signInWithPassword } from "./actions";

interface LoginPageProps {
  searchParams: Promise<{ error?: string }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { error } = await searchParams;
  const t = await getT();
  // ?error=... values set by redirects elsewhere in the app (page.tsx,
  // auth/callback/actions.ts, lib/auth/session-expiry.ts).
  const errorMessages: Record<string, string> = {
    session_expired: t("auth.login.sessionExpired"),
    auth_failed: t("auth.login.authFailed"),
    not_invited: t("auth.notInvited"),
    network: t("common.networkError"),
  };
  const errorMessage = error ? (errorMessages[error] ?? t("auth.login.genericError")) : null;

  return (
    <main className="mx-auto flex min-h-[100dvh] max-w-sm flex-col justify-center gap-6 px-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">🐦 Encrypted Pigeon</h1>
        <LanguageSelect />
      </div>

      {errorMessage && (
        <p
          role="alert"
          className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200"
        >
          {errorMessage}
        </p>
      )}

      <div className="flex flex-col gap-3">
        <p className="text-sm text-neutral-500 dark:text-night-muted">{t("auth.login.withPassword")}</p>
        <PasswordLoginForm action={signInWithPassword} />
      </div>

      <div className="flex flex-col gap-3 border-t border-neutral-200 pt-6 dark:border-night-border">
        <p className="text-sm text-neutral-500 dark:text-night-muted">
          {t("auth.login.orMagicLink")}
        </p>
        <MagicLinkForm
          action={sendMagicLink}
          submitLabel={t("auth.login.sendMagicLink")}
          pendingLabel={t("auth.sending")}
        />
      </div>
    </main>
  );
}
