"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { LOCALES, LOCALE_NAMES } from "@/lib/i18n/config";
import { useLocale, useT } from "@/lib/i18n/client";
import {
  initialMagicLinkState,
  type MagicLinkState,
} from "@/lib/auth/magic-link-state";

interface MagicLinkFormProps {
  action: (
    state: MagicLinkState,
    formData: FormData
  ) => Promise<MagicLinkState>;
  submitLabel: string;
  pendingLabel: string;
  placeholder?: string;
  /** Adds a language picker (name="language") — the language of the email that gets sent. */
  withLanguage?: boolean;
}

function SubmitButton({
  label,
  pendingLabel,
}: {
  label: string;
  pendingLabel: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded bg-accent px-3 py-2 text-on-accent disabled:opacity-50"
    >
      {pending ? pendingLabel : label}
    </button>
  );
}

export function MagicLinkForm({
  action,
  submitLabel,
  pendingLabel,
  placeholder,
  withLanguage,
}: MagicLinkFormProps) {
  const t = useT();
  const locale = useLocale();
  const [state, formAction] = useActionState(action, initialMagicLinkState);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input
        type="email"
        name="email"
        required
        placeholder={placeholder ?? t("auth.emailPlaceholder")}
        className="rounded border border-neutral-300 px-3 py-2 dark:border-night-border"
      />
      {withLanguage && (
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-neutral-500 dark:text-night-muted">{t("auth.emailLanguageLabel")}</span>
          <select
            name="language"
            defaultValue={locale}
            className="rounded border border-neutral-300 px-3 py-2 dark:border-night-border"
          >
            {LOCALES.map((code) => (
              <option key={code} value={code}>
                {LOCALE_NAMES[code]}
              </option>
            ))}
          </select>
        </label>
      )}
      <SubmitButton label={submitLabel} pendingLabel={pendingLabel} />
      {state.status !== "idle" && (
        <p
          // Keyed by the message, so each new result fades in again.
          key={state.message}
          className={
            state.status === "error"
              ? "animate-fade-in text-sm text-red-600 dark:text-red-400"
              : "animate-fade-in text-sm text-green-600 dark:text-emerald-400"
          }
        >
          {state.message}
        </p>
      )}
    </form>
  );
}
