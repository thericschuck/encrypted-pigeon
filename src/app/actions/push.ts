"use server";

import { createClient } from "@/lib/supabase/server";

export type TestPushResult =
  | { status: "sent"; devices: number }
  | { status: "no-devices" }
  | { status: "error"; message: string };

/**
 * "Test-Benachrichtigung senden" in the settings: pushes a test message to
 * all of the signed-in user's registered devices, through the same edge
 * function and VAPID keys as real notifications — so a test that arrives
 * means the whole chain works.
 *
 * The edge function only accepts the service-role key; this action is the
 * gate that makes sure people can only ever test their own devices.
 */
export async function sendTestPush(): Promise<TestPushResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { status: "error", message: "Nicht angemeldet." };

  let response: Response;
  try {
    response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/send-push-notification`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ event_type: "test", user_id: user.id }),
      cache: "no-store",
    });
  } catch {
    return { status: "error", message: "Server nicht erreichbar." };
  }

  const result = (await response.json().catch(() => null)) as
    | { sent?: number; failed?: number; error?: string }
    | null;
  if (!response.ok || !result) {
    return { status: "error", message: result?.error ?? `Fehler ${response.status}` };
  }
  if ((result.sent ?? 0) > 0) return { status: "sent", devices: result.sent ?? 0 };
  if ((result.failed ?? 0) > 0) {
    return { status: "error", message: "Zustellung an deine Geräte fehlgeschlagen." };
  }
  return { status: "no-devices" };
}
