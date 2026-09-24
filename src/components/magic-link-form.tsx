"use client";

import { useFormState, useFormStatus } from "react-dom";
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
      className="rounded bg-neutral-900 px-3 py-2 text-white disabled:opacity-50 dark:bg-night-accent dark:text-night-bg"
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
}: MagicLinkFormProps) {
  const [state, formAction] = useFormState(action, initialMagicLinkState);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input
        type="email"
        name="email"
        required
        placeholder={placeholder ?? "du@example.com"}
        className="rounded border border-neutral-300 px-3 py-2 dark:border-night-border"
      />
      <SubmitButton label={submitLabel} pendingLabel={pendingLabel} />
      {state.status !== "idle" && (
        <p
          className={
            state.status === "error"
              ? "text-sm text-red-600 dark:text-red-400"
              : "text-sm text-green-600 dark:text-emerald-400"
          }
        >
          {state.message}
        </p>
      )}
    </form>
  );
}
