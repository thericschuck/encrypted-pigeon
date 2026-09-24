"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { unsubscribeFromPush } from "@/lib/push/subscribe";

/**
 * Removes this device's push subscription first (otherwise a signed-out
 * phone would keep getting the previous user's notifications), then hands
 * off to /auth/signout, which clears the session cookies server-side.
 */
export function SignOutButton() {
  const [busy, setBusy] = useState(false);

  async function handleSignOut() {
    setBusy(true);
    try {
      await unsubscribeFromPush(createClient());
    } catch {
      // Best effort — never block signing out on this.
    }
    const form = document.createElement("form");
    form.method = "post";
    form.action = "/auth/signout";
    document.body.appendChild(form);
    form.submit();
  }

  return (
    <button
      type="button"
      onClick={handleSignOut}
      disabled={busy}
      className="w-full rounded-full border border-neutral-300 px-4 py-2 text-sm text-neutral-600 hover:bg-neutral-50 disabled:opacity-50 dark:border-night-border dark:text-night-muted dark:hover:bg-night-raised"
    >
      {busy ? "Wird abgemeldet…" : "Abmelden"}
    </button>
  );
}
