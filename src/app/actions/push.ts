"use server";

import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";

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
  const t = await getT();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { status: "error", message: t("system.push.notSignedIn") };

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
    return { status: "error", message: t("system.push.unreachable") };
  }

  const result = (await response.json().catch(() => null)) as
    | { sent?: number; failed?: number; error?: string }
    | null;
  if (!response.ok || !result) {
    return { status: "error", message: result?.error ?? t("system.push.httpError", { status: response.status }) };
  }
  if ((result.sent ?? 0) > 0) return { status: "sent", devices: result.sent ?? 0 };
  if ((result.failed ?? 0) > 0) {
    return { status: "error", message: t("system.push.deliveryFailed") };
  }
  return { status: "no-devices" };
}
