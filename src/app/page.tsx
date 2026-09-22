import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ensureProfileAndHomeChat } from "@/lib/auth/bootstrap";
import { isAdminEmail } from "@/lib/auth/admin-email";

export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email) {
    redirect("/login");
  }

  if (isAdminEmail(user.email)) {
    redirect("/admin/invite");
  }

  const { data: existing } = await supabase
    .from("chat_participants")
    .select("chat_id")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();

  if (existing) {
    redirect(`/chat/${existing.chat_id}`);
  }

  // Self-heal: a returning user with no chat yet (shouldn't normally happen,
  // the callback creates it on first login).
  const { chatId } = await ensureProfileAndHomeChat({
    id: user.id,
    email: user.email,
  });

  redirect(chatId ? `/chat/${chatId}` : "/login?error=no_chat");
}
