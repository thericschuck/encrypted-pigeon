"use client";

import { useEffect } from "react";

const CALLBACK_PATH = "/auth/callback";

/**
 * Safety net for email links (invite, password reset) that land somewhere
 * other than /auth/callback — e.g. when Supabase rejected the redirect URL
 * and fell back to the Site URL, and the middleware then bounced the
 * signed-out visitor on to /login. The tokens are in the URL fragment,
 * which the browser keeps across those redirects but no page other than
 * the callback reads. Hand them over to the callback instead.
 */
export function AuthHashForwarder() {
  useEffect(() => {
    if (window.location.pathname === CALLBACK_PATH) return;
    const params = new URLSearchParams(window.location.hash.substring(1));
    const carriesAuth =
      (params.has("access_token") && params.has("refresh_token")) || params.has("error_code");
    if (!carriesAuth) return;
    window.location.replace(`${CALLBACK_PATH}${window.location.hash}`);
  }, []);

  return null;
}
