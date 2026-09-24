import { redirect } from "next/navigation";

// Inviting moved onto the dashboard ("/"); kept so old links/bookmarks
// still land somewhere sensible. The invite server action itself still
// lives next to this file (./actions.ts).
export default function AdminInvitePage() {
  redirect("/");
}
