// Custom service worker logic, imported (via importScripts) into the
// Workbox service worker that @ducanh2912/next-pwa generates at build time
// — next-pwa picks up this `worker/` directory by default (its
// `customWorkerSrc` option, not overridden in next.config.mjs). Plain JS on purpose: this
// file runs in the service worker global scope (no `window`/DOM lib), and
// keeping it out of the TS project (tsconfig only includes **/*.ts(x))
// avoids fighting over "dom" vs "webworker" lib types.
//
// Push payloads are always JSON built by supabase/functions/send-push-notification:
// { title, body, tag, url }, where url is a same-origin path like "/chat/<id>".

self.addEventListener("push", (event) => {
  let payload = {};
  if (event.data) {
    try {
      payload = event.data.json();
    } catch {
      payload = { body: event.data.text() };
    }
  }

  const title = payload.title || "🕊️ Encrypted Pigeon";
  const options = {
    body: payload.body,
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    tag: payload.tag,
    data: { url: payload.url || "/" },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// Focuses an already-open tab on the target chat if there is one, otherwise
// opens a new one — rather than always stacking a fresh window.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const rawUrl = event.notification.data && event.notification.data.url;
  if (!rawUrl) return;
  // Payload URLs are relative; client.url is always absolute.
  const targetUrl = new URL(rawUrl, self.location.origin).href;

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if (client.url === targetUrl && "focus" in client) {
            return client.focus();
          }
        }
        for (const client of clientList) {
          if ("focus" in client && "navigate" in client) {
            return client.focus().then(() => client.navigate(targetUrl));
          }
        }
        if (self.clients.openWindow) {
          return self.clients.openWindow(targetUrl);
        }
      })
  );
});
