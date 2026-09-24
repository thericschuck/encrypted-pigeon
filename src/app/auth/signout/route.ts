import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Only these may be forwarded to /login?error=..., so this route can't be
// used to put arbitrary text on the login page.
const ALLOWED_ERRORS = new Set(["not_invited", "session_expired"]);

/**
 * Signs out and lands on /login. A route handler (not a Server Component)
 * because only route handlers/actions may write the cleared auth cookies.
 * POST from the settings "Abmelden" button; GET for server-side redirects
 * like the dashboard's "not a member" check.
 */
async function signOut(request: NextRequest) {
  const supabase = await createClient();
  await supabase.auth.signOut();

  const error = request.nextUrl.searchParams.get("error");
  const target = new URL("/login", request.url);
  if (error && ALLOWED_ERRORS.has(error)) target.searchParams.set("error", error);
  return NextResponse.redirect(target, { status: 303 });
}

export const GET = signOut;
export const POST = signOut;
