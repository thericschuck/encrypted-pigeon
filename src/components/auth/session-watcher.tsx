"use client";

import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { redirectToLoginForExpiredSession } from "@/lib/auth/session-expiry";

/**
 * Mounted on every signed-in page. If the session ends while the page is
 * open (refresh token revoked/expired, signed out in another tab), the
 * Supabase client emits SIGNED_OUT — redirect gently to /login right away
 * instead of letting the next request fail somewhere in the UI.
 */
export function SessionWatcher() {
  useEffect(() => {
    const supabase = createClient();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") redirectToLoginForExpiredSession();
    });
    return () => subscription.unsubscribe();
  }, []);

  return null;
}
