// Custom service worker logic, imported (via importScripts) into the
// Workbox service worker that @ducanh2912/next-pwa generates at build time
// — next-pwa picks up this `worker/` directory by default (its
// `customWorkerSrc` option, not overridden in next.config.mjs). Plain JS on purpose: this
// file runs in the service worker global scope (no `window`/DOM lib), and
// keeping it out of the TS project (tsconfig only includes **/*.ts(x))
// avoids fighting over "dom" vs "webworker" lib types.
//
// Push payloads are always JSON built by supabase/functions/send-push-notification:
// { title, body, tag, url, type, badge }, where url is a same-origin path
// like "/chat/<id>" and badge the total number of unread messages.

// How many message previews one chat notification lists at most.
const MAX_STACKED_LINES = 4;

async function showPush(payload) {
  const title = payload.title || "🕊️ Encrypted Pigeon";
  const tag = payload.tag;
  let body = payload.body || "";
  let lines = body ? [body] : [];
  let count = 1;

  // Several messages in the same chat: one notification that lists them
  // ("Anna (3)"), instead of the newest one silently replacing the others.
  if (tag && payload.type === "chat") {
    const [existing] = await self.registration.getNotifications({ tag });
    const previous = existing && existing.data;
    if (previous && Array.isArray(previous.lines)) {
      lines = [...previous.lines, ...lines].slice(-MAX_STACKED_LINES);
      count = (previous.count || previous.lines.length) + 1;
      body = lines.join("\n");
    }
  }

  await self.registration.showNotification(count > 1 ? `${title} (${count})` : title, {
    body,
    icon: "/icons/icon-192.png",
    // Android draws the badge as a white silhouette (alpha only).
    badge: "/icons/badge-96.png",
    tag,
    // Same tag = same notification slot. Without renotify, every message
    // after the first in a chat would replace it without sound/vibration.
    renotify: Boolean(tag),
    data: { url: payload.url || "/", lines, count },
  });

  // Number on the app icon (installed PWA, where supported).
  if (typeof payload.badge === "number" && "setAppBadge" in self.navigator) {
    try {
      if (payload.badge > 0) await self.navigator.setAppBadge(payload.badge);
      else await self.navigator.clearAppBadge();
    } catch {
      // Badging not allowed here — the notification itself is what matters.
    }
  }
}

self.addEventListener("push", (event) => {
  let payload = {};
  if (event.data) {
    try {
      payload = event.data.json();
    } catch {
      payload = { body: event.data.text() };
    }
  }
  event.waitUntil(showPush(payload));
});

// Focuses a tab that already shows the target chat; otherwise brings an
// open tab of the app there; otherwise opens a new window.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const rawUrl = event.notification.data && event.notification.data.url;
  if (!rawUrl) return;
  // Payload URLs are relative; client.url is always absolute.
  const target = new URL(rawUrl, self.location.origin);

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const exact = windows.find((client) => new URL(client.url).pathname === target.pathname);
      if (exact && "focus" in exact) return exact.focus();

      const other = windows.find((client) => "focus" in client && "navigate" in client);
      if (other) {
        try {
          const focused = await other.focus();
          // navigate() only works on clients this worker controls.
          const navigated = await focused.navigate(target.href);
          if (navigated) return navigated;
        } catch {
          // Fall through to a new window.
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(target.href);
    })()
  );
});
