"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useFormState, useFormStatus } from "react-dom";
import {
  initialMagicLinkState,
  type MagicLinkState,
} from "@/lib/auth/magic-link-state";

interface PasswordLoginFormProps {
  action: (
    state: MagicLinkState,
    formData: FormData
  ) => Promise<MagicLinkState>;
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded bg-accent px-3 py-2 text-on-accent disabled:opacity-50"
    >
      {pending ? "Wird angemeldet..." : "Anmelden"}
    </button>
  );
}

export function PasswordLoginForm({ action }: PasswordLoginFormProps) {
  const [state, formAction] = useFormState(action, initialMagicLinkState);
  const router = useRouter();

  // The action returns a "redirect" state instead of calling
  // next/navigation's redirect() itself — see the comment in
  // src/app/login/actions.ts for why (a Next.js useFormState + redirect()
  // bug: https://github.com/vercel/next.js/issues/68549, which is exactly
  // what threw "Cannot read properties of undefined (reading 'status')"
  // here for non-admin logins).
  useEffect(() => {
    if (state?.status === "redirect" && state.redirectTo) {
      router.push(state.redirectTo);
    }
  }, [state, router]);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input
        type="email"
        name="email"
        required
        placeholder="du@example.com"
        className="rounded border border-neutral-300 px-3 py-2 dark:border-night-border"
      />
      <input
        type="password"
        name="password"
        required
        placeholder="Passwort"
        className="rounded border border-neutral-300 px-3 py-2 dark:border-night-border"
      />
      <SubmitButton />
      {state?.status === "error" && (
        <p key={state.message} className="animate-fade-in text-sm text-red-600 dark:text-red-400">
          {state.message}
        </p>
      )}
    </form>
  );
}
