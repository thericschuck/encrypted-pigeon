import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

type PigeonClient = SupabaseClient<Database, "pigeon">;

// applicationServerKey wants a raw Uint8Array, not the base64url string the
// VAPID public key is generated/stored as.
// Backed by an explicit ArrayBuffer (not ArrayBufferLike): newer DOM typings
// reject a possibly-shared buffer for applicationServerKey.
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const output = new Uint8Array(new ArrayBuffer(rawData.length));
  for (let i = 0; i < rawData.length; i += 1) output[i] = rawData.charCodeAt(i);
  return output;
}

export function isPushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/**
 * Requests the real browser permission dialog (call this only from a user
 * gesture, after the friendly explainer prompt has already been shown/
 * accepted) and, once granted, stores the subscription for this device.
 * Returns the resulting permission so the caller can react to "denied" too.
 */
export async function requestPushPermissionAndSubscribe(
  supabase: PigeonClient,
  userId: string
): Promise<NotificationPermission> {
  if (!isPushSupported()) return "denied";

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission;

  await subscribeToPush(supabase, userId);
  return permission;
}

export async function subscribeToPush(supabase: PigeonClient, userId: string): Promise<boolean> {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!publicKey || !isPushSupported() || Notification.permission !== "granted") return false;

  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
  }

  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys) return false;

  const { error } = await supabase
    .from("push_subscriptions")
    // ignoreDuplicates = ON CONFLICT DO NOTHING: this runs on every chat
    // open for already-subscribed devices, and a real upsert would need an
    // UPDATE grant/policy the table deliberately doesn't have.
    .upsert(
      { user_id: userId, endpoint: json.endpoint, keys: json.keys },
      { onConflict: "endpoint", ignoreDuplicates: true }
    );

  return !error;
}

/** Unsubscribes and forgets *this device's* subscription (not other devices). */
export async function unsubscribeFromPush(supabase: PigeonClient): Promise<void> {
  if (!isPushSupported()) return;

  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return;

  const endpoint = subscription.endpoint;
  await subscription.unsubscribe();
  await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint);
}

/** For the settings page: is this device currently subscribed? */
export async function getCurrentPushSubscription(): Promise<PushSubscription | null> {
  if (!isPushSupported()) return null;
  const registration = await navigator.serviceWorker.getRegistration();
  return (await registration?.pushManager.getSubscription()) ?? null;
}
