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

/** False when the subscription was made with a different (older) VAPID key. */
function usesServerKey(subscription: PushSubscription, publicKey: string): boolean {
  const current = subscription.options.applicationServerKey;
  // Not exposed by every browser — then there's nothing to compare.
  if (!current) return true;
  const expected = urlBase64ToUint8Array(publicKey);
  const actual = new Uint8Array(current);
  return actual.length === expected.length && actual.every((byte, i) => byte === expected[i]);
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

  const result = await subscribeToPush(supabase, userId);
  if (!result.ok) console.error("Push subscription failed:", result.reason);
  return permission;
}

export type SubscribeResult = { ok: true } | { ok: false; reason: string };

// navigator.serviceWorker.ready never settles if no service worker gets
// registered (dev mode, blocked, failed install) — don't hang forever.
const SERVICE_WORKER_TIMEOUT_MS = 10_000;

async function readyRegistration(): Promise<ServiceWorkerRegistration | null> {
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), SERVICE_WORKER_TIMEOUT_MS)),
  ]);
}

/**
 * Subscribes this device (if it isn't yet) and makes sure the server knows
 * the subscription. Every way this can fail comes back as a reason the
 * settings can show — a silent failure here looks exactly like "push is
 * on" in the browser while the server has nowhere to send to.
 */
export async function subscribeToPush(supabase: PigeonClient, userId: string): Promise<SubscribeResult> {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!publicKey) {
    return {
      ok: false,
      reason: "Push ist in dieser App-Version nicht eingerichtet (NEXT_PUBLIC_VAPID_PUBLIC_KEY fehlt beim Build).",
    };
  }
  if (!isPushSupported()) return { ok: false, reason: "Dieser Browser unterstützt keine Push-Benachrichtigungen." };
  if (Notification.permission !== "granted") {
    return { ok: false, reason: "Benachrichtigungen sind für diese Seite nicht erlaubt." };
  }

  const registration = await readyRegistration();
  if (!registration) {
    return { ok: false, reason: "Der Service Worker der App ist nicht aktiv. Lade die Seite neu und versuch es nochmal." };
  }

  let subscription: PushSubscription | null;
  try {
    subscription = await registration.pushManager.getSubscription();
    if (subscription && !usesServerKey(subscription, publicKey)) {
      // The VAPID key was changed since: pushes to this subscription are
      // rejected by the push service. Replace it with one for the new key.
      const staleEndpoint = subscription.endpoint;
      await subscription.unsubscribe();
      await supabase.from("push_subscriptions").delete().eq("endpoint", staleEndpoint);
      subscription = null;
    }
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
    }
  } catch (error) {
    return { ok: false, reason: `Browser hat das Abo abgelehnt: ${(error as Error).message}` };
  }

  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys) return { ok: false, reason: "Der Browser hat ein unvollständiges Abo geliefert." };

  const { error } = await supabase
    .from("push_subscriptions")
    // ignoreDuplicates = ON CONFLICT DO NOTHING: this runs on every chat
    // open for already-subscribed devices, and a real upsert would need an
    // UPDATE grant/policy the table deliberately doesn't have.
    .upsert(
      { user_id: userId, endpoint: json.endpoint, keys: json.keys },
      { onConflict: "endpoint", ignoreDuplicates: true }
    );
  if (error) return { ok: false, reason: `Abo konnte nicht gespeichert werden: ${error.message}` };

  // ON CONFLICT DO NOTHING also "succeeds" when the endpoint is stored for
  // another account (shared device) — only a row of our own counts.
  if (!(await isSubscriptionStored(supabase, json.endpoint))) {
    return {
      ok: false,
      reason:
        "Dieses Gerät ist noch für ein anderes Konto registriert. Schalte Benachrichtigungen aus und wieder ein.",
    };
  }
  return { ok: true };
}

/** Whether the server has this endpoint for the signed-in user (RLS: own rows only). */
export async function isSubscriptionStored(supabase: PigeonClient, endpoint: string): Promise<boolean> {
  const { data } = await supabase
    .from("push_subscriptions")
    .select("id")
    .eq("endpoint", endpoint)
    .maybeSingle();
  return !!data;
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
