import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";
import { forbiddenResponse, isServiceRoleRequest } from "../_shared/service-role-auth.ts";

/**
 * Called via pg_net from three places (see the push_notifications
 * migration): a new-message insert trigger, a pigeon_flights "delivered"
 * update trigger, and a per-minute cron job that flags at most one incident
 * per flight. Works out who should be notified and with what text, then
 * sends a Web Push message (native browser API, VAPID-signed — no Firebase)
 * to every stored subscription for those users.
 *
 * Chat messages vs. pigeon letters: a letter's content must not leak
 * before the pigeon lands (the recipient can't read it via RLS either), so
 * on send the recipient only gets "a pigeon is on its way"; the content
 * preview comes with the "arrived" push.
 *
 * Runs with the service-role key so it can read push_subscriptions and
 * chat_participants across users — this is server-authoritative fan-out,
 * not something any single user's RLS grant should cover.
 */

type EventType = "message" | "incident" | "arrived";

interface RequestBody {
  event_type: EventType;
  message_id: string;
  event?: { label?: string; emoji?: string };
}

interface PushSubscriptionRow {
  id: string;
  user_id: string;
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

interface MessageRow {
  chat_id: string;
  sender_id: string;
  kind: "chat" | "pigeon";
  content: string | null;
  image_url: string | null;
  audio_url: string | null;
}

interface ProfileRow {
  id: string;
  email: string;
  display_name: string | null;
  pigeon_name: string | null;
}

interface Notification {
  title: string;
  body: string;
  tag: string;
  url: string;
}

const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY");
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY");
const DEFAULT_PIGEON_NAME = "Deine Taube";

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails("mailto:pigeon@encrypted-pigeon.com", VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function displayName(profile: ProfileRow | undefined): string {
  return profile?.display_name ?? profile?.email.split("@")[0] ?? "Jemand";
}

function contentPreview(message: MessageRow): string {
  if (message.content) return truncate(message.content, 120);
  if (message.image_url) return "📷 Bild";
  if (message.audio_url) return "🎤 Sprachnachricht";
  return "Neue Nachricht";
}

/** Returns null when this user shouldn't get a push for this event. */
function buildNotification(
  body: RequestBody,
  message: MessageRow,
  targetUserId: string,
  sender: ProfileRow | undefined
): Notification | null {
  const url = `/chat/${message.chat_id}`;
  const isSender = targetUserId === message.sender_id;
  const senderName = displayName(sender);
  const pigeonName = sender?.pigeon_name ?? null;
  const flightTag = `flight-${body.message_id}`;

  if (body.event_type === "message") {
    // The sender already sees their own message.
    if (isSender) return null;
    if (message.kind === "pigeon") {
      return {
        title: `🕊️ ${pigeonName ?? "Eine Brieftaube"} ist zu dir unterwegs`,
        body: `${senderName} hat dir einen Brief geschickt. Verfolge den Flug im Chat!`,
        tag: flightTag,
        url,
      };
    }
    return { title: `💬 ${senderName}`, body: contentPreview(message), tag: `chat-${message.chat_id}`, url };
  }

  if (body.event_type === "incident") {
    const label = body.event?.label ?? "Unterwegs ist etwas passiert.";
    const emoji = body.event?.emoji ?? "⚠️";
    const who = isSender ? (pigeonName ?? DEFAULT_PIGEON_NAME) : `Die Taube von ${senderName}`;
    return { title: `🕊️ ${who}: Zwischenfall!`, body: `${emoji} ${label}`, tag: flightTag, url };
  }

  // arrived
  if (isSender) {
    return {
      title: `🕊️ ${pigeonName ?? DEFAULT_PIGEON_NAME} ist angekommen`,
      body: "Dein Brief wurde zugestellt.",
      tag: flightTag,
      url,
    };
  }
  return {
    title: `✉️ Brief von ${senderName} ist da!`,
    body: contentPreview(message),
    tag: flightTag,
    url,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  if (!isServiceRoleRequest(req)) {
    return forbiddenResponse();
  }

  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    console.error("VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY not configured");
    return new Response(JSON.stringify({ error: "Push not configured" }), { status: 500 });
  }

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), { status: 400 });
  }

  if (!body.message_id || !body.event_type) {
    return new Response(JSON.stringify({ error: "message_id and event_type are required" }), {
      status: 400,
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { db: { schema: "pigeon" }, auth: { persistSession: false } }
  );

  const { data: message, error: messageError } = await supabase
    .from("messages")
    .select("chat_id, sender_id, kind, content, image_url, audio_url")
    .eq("id", body.message_id)
    .maybeSingle<MessageRow>();

  if (messageError || !message) {
    console.error("Message lookup failed:", messageError?.message);
    return new Response(JSON.stringify({ error: "Message not found" }), { status: 404 });
  }

  const { data: participants, error: participantsError } = await supabase
    .from("chat_participants")
    .select("user_id")
    .eq("chat_id", message.chat_id);

  if (participantsError || !participants) {
    console.error("Participants lookup failed:", participantsError?.message);
    return new Response(JSON.stringify({ error: "Participants not found" }), { status: 500 });
  }

  const { data: senderProfile } = await supabase
    .from("profiles")
    .select("id, email, display_name, pigeon_name")
    .eq("id", message.sender_id)
    .maybeSingle<ProfileRow>();

  const notificationsByUser = new Map<string, Notification>();
  for (const { user_id } of participants) {
    const notification = buildNotification(body, message, user_id, senderProfile ?? undefined);
    if (notification) notificationsByUser.set(user_id, notification);
  }

  if (notificationsByUser.size === 0) {
    return new Response(JSON.stringify({ sent: 0, failed: 0 }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  const { data: subscriptions, error: subscriptionsError } = await supabase
    .from("push_subscriptions")
    .select("id, user_id, endpoint, keys")
    .in("user_id", Array.from(notificationsByUser.keys()));

  if (subscriptionsError) {
    console.error("Subscriptions lookup failed:", subscriptionsError.message);
    return new Response(JSON.stringify({ error: "Subscriptions lookup failed" }), { status: 500 });
  }

  let sent = 0;
  let failed = 0;
  const staleSubscriptionIds: string[] = [];

  await Promise.all(
    ((subscriptions ?? []) as PushSubscriptionRow[]).map(async (subscription) => {
      const notification = notificationsByUser.get(subscription.user_id);
      if (!notification) return;
      try {
        await webpush.sendNotification(
          { endpoint: subscription.endpoint, keys: subscription.keys },
          // url is relative on purpose: the service worker resolves it
          // against its own origin, so this works on localhost, previews
          // and production alike.
          JSON.stringify(notification)
        );
        sent += 1;
      } catch (error) {
        failed += 1;
        const statusCode = (error as { statusCode?: number }).statusCode;
        if (statusCode === 404 || statusCode === 410) {
          // Subscription expired or was revoked on the browser side — clean
          // it up so we stop trying.
          staleSubscriptionIds.push(subscription.id);
        } else {
          console.error("Push send failed:", error);
        }
      }
    })
  );

  if (staleSubscriptionIds.length > 0) {
    await supabase.from("push_subscriptions").delete().in("id", staleSubscriptionIds);
  }

  return new Response(JSON.stringify({ sent, failed }), {
    headers: { "Content-Type": "application/json" },
  });
});
