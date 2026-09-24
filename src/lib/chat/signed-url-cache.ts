/**
 * Signed URLs for chat attachments (private buckets), reused for as long
 * as they're valid — across chat switches (module memory) and app restarts
 * (localStorage, per user).
 *
 * Reusing the exact same URL is what makes the browser's HTTP cache work
 * for attachments: every freshly signed URL carries a new token, so to the
 * browser it's a different file and gets downloaded again. With this, an
 * image or voice message is signed once a day and downloaded once.
 *
 * Attachment objects never change after upload (one path per message), so
 * a cached URL can't point at stale content.
 */

/** How long a signed URL is valid. */
export const SIGNED_URL_TTL_SECONDS = 24 * 60 * 60;
// Hand out cached URLs only while they're comfortably valid, so one
// doesn't expire while an image is still loading / a voice message playing.
const MIN_REMAINING_MS = 60 * 60 * 1000;
const STORAGE_KEY_PREFIX = "pigeon.signed-urls.v1.";

interface CachedUrl {
  url: string;
  expiresAt: number;
}

let loadedForUser: string | null = null;
let cache = new Map<string, CachedUrl>();

function storageKey(userId: string) {
  return `${STORAGE_KEY_PREFIX}${userId}`;
}

function ensureLoaded(userId: string) {
  if (loadedForUser === userId) return;
  loadedForUser = userId;
  cache = new Map();
  try {
    const raw = window.localStorage.getItem(storageKey(userId));
    if (!raw) return;
    const now = Date.now();
    for (const [path, entry] of Object.entries(JSON.parse(raw) as Record<string, CachedUrl>)) {
      if (entry.expiresAt - now > MIN_REMAINING_MS) cache.set(path, entry);
    }
  } catch {
    // Storage blocked / corrupt: just start empty.
  }
}

function persist(userId: string) {
  try {
    window.localStorage.setItem(storageKey(userId), JSON.stringify(Object.fromEntries(cache)));
  } catch {
    // Storage full / blocked: the in-memory cache still works.
  }
}

/** Cached, still comfortably valid signed URL for `path`, if any. */
export function getCachedSignedUrl(userId: string, path: string): string | undefined {
  ensureLoaded(userId);
  const entry = cache.get(path);
  if (!entry) return undefined;
  if (entry.expiresAt - Date.now() > MIN_REMAINING_MS) return entry.url;
  cache.delete(path);
  return undefined;
}

/** Remembers freshly signed URLs (signed just now with SIGNED_URL_TTL_SECONDS). */
export function cacheSignedUrls(userId: string, entries: { path: string; url: string }[]) {
  if (entries.length === 0) return;
  ensureLoaded(userId);
  const expiresAt = Date.now() + SIGNED_URL_TTL_SECONDS * 1000;
  const now = Date.now();
  // Drop expired entries while we're at it, so storage doesn't grow forever.
  cache.forEach((entry, path) => {
    if (entry.expiresAt <= now) cache.delete(path);
  });
  for (const { path, url } of entries) cache.set(path, { url, expiresAt });
  persist(userId);
}

/** Forget a URL that stopped working (e.g. revoked), so it's re-signed. */
export function forgetSignedUrl(userId: string, path: string) {
  ensureLoaded(userId);
  if (cache.delete(path)) persist(userId);
}
