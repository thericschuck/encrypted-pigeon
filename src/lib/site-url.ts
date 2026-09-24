import { headers } from "next/headers";

/**
 * Absolute URL of /auth/callback for links sent by email (invite, magic
 * link, password reset). Server-only.
 *
 * NEXT_PUBLIC_SITE_URL wins when set. Without it (forgotten in the hosting
 * env, preview deploys) this falls back to the origin of the current
 * request instead of producing "undefined/auth/callback" — which Supabase
 * rejects and silently replaces with the project's Site URL, so the link
 * would land on the start page instead of the callback.
 *
 * Supabase only honours URLs on its Redirect URLs allowlist
 * (Dashboard → Authentication → URL Configuration), so the production
 * origin must be listed there, e.g. https://encrypted-pigeon.com/**.
 */
export async function authCallbackUrl(): Promise<string> {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "");
  if (configured) return `${configured}/auth/callback`;

  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto =
    h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}/auth/callback`;
}
