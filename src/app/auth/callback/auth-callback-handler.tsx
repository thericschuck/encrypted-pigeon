"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { completeAuthCallback } from "./actions";

/**
 * Two links land here, needing two different handoffs:
 *
 * - Self-service magic link (login/actions.ts, same browser sends+clicks):
 *   PKCE `?code=...` in the query string.
 * - Admin-generated invite/reset link (admin/invite/actions.ts, sent via the
 *   service-role client so it isn't tied to any browser's PKCE cookie):
 *   implicit-flow `#access_token=...&refresh_token=...` in the URL hash.
 *
 * Fragments never reach the server, so this has to run client-side.
 */
function readAuthParams(search: URLSearchParams) {
  const hash = typeof window !== "undefined" ? window.location.hash.substring(1) : "";
  const fromHash = new URLSearchParams(hash);
  const pick = (key: string) => search.get(key) ?? fromHash.get(key);

  return {
    error: pick("error") ?? pick("error_code"),
    errorDescription: pick("error_description"),
    code: search.get("code"),
    accessToken: fromHash.get("access_token"),
    refreshToken: fromHash.get("refresh_token"),
  };
}

export function AuthCallbackHandler() {
  const searchParams = useSearchParams();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();

    async function run() {
      const params = readAuthParams(searchParams);

      if (params.error) {
        setErrorMessage(params.errorDescription ?? params.error);
        return;
      }

      if (params.code) {
        const { error } = await supabase.auth.exchangeCodeForSession(params.code);
        if (error) {
          setErrorMessage(error.message);
          return;
        }
      } else if (params.accessToken && params.refreshToken) {
        const { error } = await supabase.auth.setSession({
          access_token: params.accessToken,
          refresh_token: params.refreshToken,
        });
        if (error) {
          setErrorMessage(error.message);
          return;
        }
      } else {
        setErrorMessage("Kein gültiger Anmeldelink gefunden.");
        return;
      }

      await completeAuthCallback();
    }

    run();
  }, [searchParams]);

  return (
    <main className="flex min-h-[100dvh] items-center justify-center px-6">
      <p className="text-sm text-neutral-500 dark:text-night-muted">
        {errorMessage ? `Anmeldung fehlgeschlagen: ${errorMessage}` : "Wird angemeldet..."}
      </p>
    </main>
  );
}
