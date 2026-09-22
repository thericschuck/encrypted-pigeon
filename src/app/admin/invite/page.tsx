import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdminEmail } from "@/lib/auth/admin-email";
import { MagicLinkForm } from "@/components/magic-link-form";
import { inviteUser } from "./actions";

export default async function AdminInvitePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }
  if (!isAdminEmail(user.email)) {
    redirect("/");
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 px-6">
      <h1 className="text-2xl font-semibold">Freund einladen</h1>
      <p className="text-sm text-neutral-500">
        Verschickt einen Magic Link, der die Person direkt in euren 1:1-Chat
        führt.
      </p>
      <MagicLinkForm
        action={inviteUser}
        submitLabel="Einladen"
        pendingLabel="Wird versendet..."
      />
    </main>
  );
}
