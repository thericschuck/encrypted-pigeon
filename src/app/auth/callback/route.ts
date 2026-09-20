import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ensureProfileAndHomeChat } from "@/lib/auth/bootstrap";
import { isAdminEmail } from "@/lib/auth/admin-email";

/**
 * Magic-link landing target (see emailRedirectTo in login/actions.ts and
 * admin/invite/actions.ts). Exchanges the auth code for a session, then
 * bootstraps the profile/chat rows this project needs before sending the
 * user somewhere useful.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=missing_code`);
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !data.user?.email) {
    return NextResponse.redirect(`${origin}/login?error=auth_failed`);
  }

  const user = { id: data.user.id, email: data.user.email };

  if (isAdminEmail(user.email)) {
    await ensureProfileAndHomeChat(user);
    return NextResponse.redirect(`${origin}/admin/invite`);
  }

  const { chatId } = await ensureProfileAndHomeChat(user);

  if (!chatId) {
    return NextResponse.redirect(`${origin}/login?error=no_chat`);
  }

  return NextResponse.redirect(`${origin}/chat/${chatId}`);
}
