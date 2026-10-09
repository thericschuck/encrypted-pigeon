"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { isNetworkError } from "@/lib/supabase/resilient-fetch";
import { useT } from "@/lib/i18n/client";
import type { TFunction } from "@/lib/i18n/translate";

const MIN_PASSWORD_LENGTH = 8;

interface SetPasswordFormProps {
  email: string | null;
  initialDisplayName: string;
  /** Where to continue once the password is set. */
  next: string;
}

function passwordErrorMessage(t: TFunction, error: { message: string; code?: string }): string {
  if (isNetworkError(error)) return t("common.networkError");
  if (error.code === "same_password") {
    return t("auth.setPassword.samePassword");
  }
  if (error.code === "weak_password") {
    return t("auth.setPassword.weakPassword");
  }
  return t("auth.setPassword.saveFailedWith", { message: error.message });
}

/**
 * Runs in the browser on purpose: the session the invite link created
 * lives in this browser's cookies, and updateUser() changes the password
 * of exactly that signed-in account.
 */
export function SetPasswordForm({ email, initialDisplayName, next }: SetPasswordFormProps) {
  const router = useRouter();
  const t = useT();
  const [displayName, setDisplayName] = useState(initialDisplayName);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(t("auth.setPassword.tooShort", { min: MIN_PASSWORD_LENGTH }));
      return;
    }
    if (password !== confirmation) {
      setError(t("auth.setPassword.mismatch"));
      return;
    }

    setPending(true);
    const supabase = createClient();
    const { data, error: passwordError } = await supabase.auth.updateUser({ password });
    if (passwordError || !data.user) {
      setError(passwordError ? passwordErrorMessage(t, passwordError) : t("auth.setPassword.saveFailed"));
      setPending(false);
      return;
    }

    const trimmedName = displayName.trim();
    if (trimmedName !== initialDisplayName.trim()) {
      // Not fatal: the name can still be changed in the settings.
      const { error: profileError } = await supabase
        .from("profiles")
        .update({ display_name: trimmedName || null })
        .eq("id", data.user.id);
      if (profileError) console.error("Failed to save display name:", profileError.message);
    }

    router.replace(next);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      {email && (
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-neutral-500 dark:text-night-muted">{t("auth.setPassword.emailLabel")}</span>
          <input
            type="email"
            value={email}
            readOnly
            autoComplete="username"
            className="rounded border border-neutral-200 bg-neutral-50 px-3 py-2 text-neutral-500 dark:border-night-border dark:bg-night-surface dark:text-night-muted"
          />
        </label>
      )}
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-neutral-500 dark:text-night-muted">{t("auth.setPassword.nameLabel")}</span>
        <input
          type="text"
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          autoComplete="nickname"
          placeholder={t("auth.setPassword.namePlaceholder")}
          className="rounded border border-neutral-300 px-3 py-2 text-base sm:text-sm dark:border-night-border"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-neutral-500 dark:text-night-muted">{t("auth.setPassword.passwordLabel")}</span>
        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
          minLength={MIN_PASSWORD_LENGTH}
          autoComplete="new-password"
          placeholder={t("auth.setPassword.passwordPlaceholder", { min: MIN_PASSWORD_LENGTH })}
          className="rounded border border-neutral-300 px-3 py-2 text-base sm:text-sm dark:border-night-border"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-neutral-500 dark:text-night-muted">{t("auth.setPassword.repeatLabel")}</span>
        <input
          type="password"
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
          required
          autoComplete="new-password"
          className="rounded border border-neutral-300 px-3 py-2 text-base sm:text-sm dark:border-night-border"
        />
      </label>
      <button
        type="submit"
        disabled={pending}
        className="rounded bg-accent px-3 py-2 text-on-accent disabled:opacity-50"
      >
        {pending ? t("auth.setPassword.saving") : t("auth.setPassword.submit")}
      </button>
      {error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </form>
  );
}
