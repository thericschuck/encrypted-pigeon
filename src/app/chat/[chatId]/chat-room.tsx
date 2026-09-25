"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { AnimatePresence } from "framer-motion";
import { createClient } from "@/lib/supabase/client";
import type { Database, MessageKind } from "@/lib/supabase/types";
import { ChatUploadError, uploadToBucket } from "@/lib/chat/storage-upload";
import {
  CHAT_IMAGE_BUCKET,
  buildChatAttachmentPath,
  compressChatImage,
} from "@/lib/chat/image-upload";
import { CHAT_VIDEO_BUCKET } from "@/lib/chat/buckets";
import { looksLikeImage } from "@/lib/media/image";
import { VideoTooLargeError, looksLikeVideo, processVideo } from "@/lib/media/video";
import {
  CHAT_VOICE_BUCKET,
  baseMimeType,
  buildChatVoicePath,
} from "@/lib/chat/voice-recording";
import { FLIGHT_COLUMNS, type FlightRow } from "@/lib/chat/flights";
import { CHAT_PAGE_SIZE } from "@/lib/chat/pagination";
import { previewOf } from "@/lib/chat/chat-overview";
import { noteChatActivity } from "@/lib/chat/chat-list-store";
import {
  SIGNED_URL_TTL_SECONDS,
  cacheSignedUrls,
  forgetSignedUrl,
  getCachedSignedUrl,
} from "@/lib/chat/signed-url-cache";
import { playEncryptStart, playPigeonTakeoff } from "@/lib/chat/chime-sounds";
import {
  isSessionExpiredError,
  redirectToLoginForExpiredSession,
} from "@/lib/auth/session-expiry";
import { displayNameOf, pigeonNameOf, type MemberProfile } from "@/lib/profile";
import { ImageLightbox } from "@/components/chat/image-lightbox";
import { ChatVideo, VideoLightbox } from "@/components/chat/chat-video";
import { VoiceMessagePlayer } from "@/components/chat/voice-message-player";
import { VoiceRecorderButton, type RecordedVoice } from "@/components/chat/voice-recorder-button";
import { EncryptionBackdrop } from "@/components/chat/encryption-sequence";
import { CodeRain } from "@/components/chat/code-rain";
import { NewMessagesButton, UnreadDivider } from "@/components/chat/unread-markers";
import { useChatReadState } from "@/lib/chat/use-chat-read-state";
import { PigeonFlightMap } from "@/components/chat/pigeon-flight-map";
import { PigeonStatusBadge } from "@/components/chat/pigeon-status-badge";
import {
  ReplyComposerPreview,
  ReplyQuote,
  ReplyableRow,
  type QuoteInfo,
} from "@/components/chat/message-reply";
import { PushPermissionPrompt } from "@/components/push/push-permission-prompt";
import { AvailabilityHint } from "@/components/chat/availability-hint";
import type { Schedule } from "@/lib/schedule/schedule";
import { Skeleton } from "@/components/ui/skeleton";

type MessageRow = Database["pigeon"]["Tables"]["messages"]["Row"];

type PendingAttachment =
  | { kind: "image"; file: File; previewUrl: string }
  | { kind: "video"; file: File; previewUrl: string }
  | { kind: "voice"; blob: Blob; previewUrl: string; durationSeconds: number; mimeType: string };

type DisplayMessage = MessageRow & {
  pending?: boolean;
  // Present (0-100) while an attachment is uploading; undefined once the
  // message is fully sent or before any attachment finishes.
  uploadProgress?: number;
  /** What uploadProgress measures: shrinking the file first, then sending it. */
  uploadPhase?: "processing" | "uploading";
  uploadError?: string;
  // Local object URLs, kept around so we can show an instant preview and
  // support "retry" without re-picking the file / re-recording.
  localImagePreview?: string;
  localAudioPreview?: string;
  localVideoPreview?: string;
  pendingAttachment?: PendingAttachment;
};

// What the message list renders: real messages, plus a placeholder for
// every pigeon letter flying towards me that I'm not allowed to read yet.
type TimelineItem =
  | { type: "message"; key: string; sortAt: number; message: DisplayMessage }
  | { type: "incoming"; key: string; sortAt: number; flight: FlightRow };

interface ChatRoomProps {
  chatId: string;
  me: MemberProfile;
  partner: MemberProfile | null;
  /** The newest CHAT_PAGE_SIZE messages, oldest first. */
  initialMessages: MessageRow[];
  /** Whether there are messages older than initialMessages. */
  initialHasOlder: boolean;
  /** Up to when I had read this chat before opening it ("Neue Nachrichten" line). */
  initialLastReadAt: string | null;
  /** The partner's Wochenplan, if it's visible to me (busy hint above the composer). */
  partnerSchedule: Schedule | null;
}

interface StorageRef {
  bucket: string;
  path: string;
}

// How close to the bottom (px) still counts as "at the bottom" for
// deciding whether to auto-scroll on new messages.
const BOTTOM_THRESHOLD_PX = 80;
// How close to the top (px) starts loading the next older page, so it's
// usually there before the user actually reaches the top.
const LOAD_OLDER_THRESHOLD_PX = 400;
// Back from the background after this long: catch up even if the realtime
// socket looks fine. Shorter than the chat list's 5 min — missing a message
// in the open chat matters more.
const RESYNC_AFTER_HIDDEN_MS = 60 * 1000;
// Collapses simultaneous catch-up triggers into one resync.
const RESYNC_DEBOUNCE_MS = 500;
// How long a message stays highlighted after jumping to it from a quote.
const JUMP_HIGHLIGHT_MS = 1600;
// The composer grows with its text up to this height (px), then scrolls:
// about six lines in a chat, more room for a letter.
const COMPOSER_MAX_HEIGHT_PX = { chat: 160, pigeon: 280 } as const;

// Unsent text per chat and device, like WhatsApp drafts.
function draftStorageKey(userId: string, chatId: string) {
  return `pigeon-draft:${userId}:${chatId}`;
}

function sendErrorMessage(): string {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return "Keine Internetverbindung. Nachricht wurde nicht gesendet.";
  }
  return "Nachricht konnte nicht gesendet werden.";
}

function formatRemainingShort(arrivalIso: string | null, now: number): string | null {
  if (!arrivalIso) return null;
  const seconds = Math.max(0, (Date.parse(arrivalIso) - now) / 1000);
  if (seconds < 60) return "gleich da";
  return `noch ca. ${Math.ceil(seconds / 60)} Min`;
}

/**
 * Image bubble content: a skeleton holds the space until the bytes arrive
 * (so the bubble doesn't jump from 0px to full height), and the <img> is
 * lazy — offscreen history images only load when scrolled near.
 */
function ChatImage({
  src,
  interactive,
  onOpen,
  onLoad,
  onError,
}: {
  src: string;
  interactive: boolean;
  onOpen: () => void;
  onLoad: () => void;
  onError: () => void;
}) {
  const [loaded, setLoaded] = useState(false);

  return (
    <>
      {!loaded && <Skeleton className="absolute inset-0 rounded-xl" />}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt="Bild"
        loading="lazy"
        decoding="async"
        onLoad={() => {
          setLoaded(true);
          onLoad();
        }}
        onError={onError}
        onClick={() => {
          if (interactive) onOpen();
        }}
        className={`max-h-64 w-full rounded-xl object-cover transition-opacity ${
          loaded ? "opacity-100" : "min-h-40 opacity-0"
        } ${interactive ? "cursor-zoom-in" : ""}`}
      />
    </>
  );
}

function isPartnerMessage(item: TimelineItem, currentUserId: string) {
  return item.type === "message" && item.message.sender_id !== currentUserId;
}

export function ChatRoom({
  chatId,
  me,
  partner,
  initialMessages,
  initialHasOlder,
  initialLastReadAt,
  partnerSchedule,
}: ChatRoomProps) {
  const currentUserId = me.id;
  const [messages, setMessages] = useState<DisplayMessage[]>(initialMessages);
  const [flights, setFlights] = useState<Record<string, FlightRow>>({});
  const [flightsLoading, setFlightsLoading] = useState(true);
  const [mode, setMode] = useState<MessageKind>("chat");
  const [draft, setDraft] = useState("");
  const [attachment, setAttachment] = useState<PendingAttachment | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [videoLightboxSrc, setVideoLightboxSrc] = useState<string | null>(null);
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});
  const [attachmentLoadErrors, setAttachmentLoadErrors] = useState<Record<string, string>>({});
  const [composerError, setComposerError] = useState<string | null>(null);
  // The message the composer is currently answering ("Antworten").
  const [replyTo, setReplyTo] = useState<DisplayMessage | null>(null);
  // Quoted messages outside the loaded window, fetched by id. null = not
  // readable for me (deleted, or a letter to me still in the air).
  const [quotedOutsideWindow, setQuotedOutsideWindow] = useState<Record<string, MessageRow | null>>({});
  const requestedQuotedIds = useRef<Set<string>>(new Set());
  // Clicking a quote: scroll to the original (loading older pages until
  // it's there), then highlight it briefly.
  const [jumpTargetId, setJumpTargetId] = useState<string | null>(null);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  // Desktop (mouse + keyboard): Enter sends, Shift+Enter is a new line.
  // Touch screens: Enter is a new line, the button sends — like WhatsApp.
  const sendsOnEnterRef = useRef(false);
  // The own chat message whose hacker show is playing in the chat
  // background. One at a time: a new send restarts the show for the newest
  // message (the earlier ones are already sent either way).
  const [encryptingId, setEncryptingId] = useState<string | null>(null);
  const [openFlightMessageId, setOpenFlightMessageId] = useState<string | null>(null);
  // Coarse clock for the "noch ca. X Min" on incoming-pigeon placeholders.
  const [now, setNow] = useState(() => Date.now());
  const scrollRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const requestedSignedUrlPaths = useRef<Set<string>>(new Set());
  const requestedLandedLetterIds = useRef<Set<string>>(new Set());
  // Every object URL this component creates, revoked on unmount so leaving
  // the chat doesn't keep recorded audio / picked images alive in memory.
  const objectUrlsRef = useRef<Set<string>>(new Set());
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  // created_at of the newest row that actually came from the server — the
  // cursor for catching up on anything missed while the socket was down.
  const latestServerCreatedAtRef = useRef<string | null>(
    initialMessages.length > 0 ? initialMessages[initialMessages.length - 1].created_at : null
  );
  // created_at of the oldest loaded server row — the history window starts
  // here. Also bounds which flights / landed letters are worth loading:
  // anything that happened before it belongs to not-yet-loaded history.
  const [oldestLoadedAt, setOldestLoadedAt] = useState<string | null>(
    initialMessages.length > 0 ? initialMessages[0].created_at : null
  );
  const oldestLoadedAtRef = useRef(oldestLoadedAt);
  oldestLoadedAtRef.current = oldestLoadedAt;
  const [hasOlder, setHasOlder] = useState(initialHasOlder);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const loadingOlderRef = useRef(false);
  // scrollHeight right before older messages were prepended, so the view
  // can stay on the message the user was looking at.
  const scrollHeightBeforePrependRef = useRef<number | null>(null);

  const partnerName = displayNameOf(partner);
  const myPigeonName = pigeonNameOf(me);
  const partnerPigeonName = pigeonNameOf(partner);

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  const createObjectUrl = useCallback((blob: Blob) => {
    const url = URL.createObjectURL(blob);
    objectUrlsRef.current.add(url);
    return url;
  }, []);

  useEffect(() => {
    const urls = objectUrlsRef.current;
    return () => {
      urls.forEach((url) => URL.revokeObjectURL(url));
      urls.clear();
    };
  }, []);

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(interval);
  }, []);

  // Start pinned to the bottom on first render.
  useEffect(() => {
    scrollToBottom();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const appendServerMessages = useCallback(
    (incoming: MessageRow[]) => {
      if (incoming.length === 0) return;
      // Lets the (server-rendered) chat list show this without a refetch.
      for (const m of incoming) {
        noteChatActivity(chatId, {
          preview: previewOf(m),
          kind: m.kind,
          createdAt: m.created_at,
          fromMe: m.sender_id === currentUserId,
        });
      }
      // Compared as dates, not strings: realtime payloads and PostgREST don't
      // format timestamptz identically. Duplicates from the (ms-rounded)
      // cursor are harmless — they're filtered by id below.
      for (const m of incoming) {
        const current = latestServerCreatedAtRef.current;
        if (!current || Date.parse(m.created_at) > Date.parse(current)) {
          latestServerCreatedAtRef.current = new Date(m.created_at).toISOString();
        }
      }
      setMessages((prev) => {
        const known = new Set(prev.map((m) => m.id));
        const fresh = incoming.filter((m) => !known.has(m.id));
        return fresh.length > 0 ? [...prev, ...fresh] : prev;
      });
    },
    [chatId, currentUserId]
  );

  const mergeFlights = useCallback((rows: FlightRow[]) => {
    if (rows.length === 0) return;
    setFlights((prev) => {
      const next = { ...prev };
      for (const row of rows) next[row.message_id] = row;
      return next;
    });
  }, []);

  // One query for the flights that matter for the loaded window: every
  // letter still in the air (including ones flying to me whose message row
  // I can't read yet), plus everything that landed within the window.
  // Older landed flights come along with their history page.
  const fetchFlights = useCallback(async () => {
    const supabase = createClient();
    let query = supabase.from("pigeon_flights").select(FLIGHT_COLUMNS).eq("chat_id", chatId);
    const windowStart = oldestLoadedAtRef.current;
    if (windowStart) {
      query = query.or(`status.neq.delivered,arrival_time.gte."${windowStart}"`);
    }
    const { data, error } = await query;
    if (error) {
      if (isSessionExpiredError(error)) redirectToLoginForExpiredSession();
      else console.error("Failed to load pigeon flights:", error.message);
      return;
    }
    mergeFlights((data ?? []) as unknown as FlightRow[]);
  }, [chatId, mergeFlights]);

  // Catch up on anything missed while the realtime socket was down
  // (phone asleep, tab in background, flaky network).
  const resync = useCallback(async () => {
    const supabase = createClient();
    let query = supabase
      .from("messages")
      .select("*")
      .eq("chat_id", chatId)
      .order("created_at", { ascending: true });
    if (latestServerCreatedAtRef.current) {
      query = query.gt("created_at", latestServerCreatedAtRef.current);
    }
    const { data, error } = await query;
    if (error) {
      if (isSessionExpiredError(error)) redirectToLoginForExpiredSession();
      return;
    }
    appendServerMessages(data ?? []);
    await fetchFlights();
  }, [appendServerMessages, chatId, fetchFlights]);

  useEffect(() => {
    let cancelled = false;
    fetchFlights().finally(() => {
      if (!cancelled) setFlightsLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [fetchFlights]);

  // A letter to me just landed: RLS lets me read it now, but it's older
  // than the resync cursor (created at send time), so fetch it by id.
  // Only letters that landed inside the loaded window — earlier ones are
  // part of history that isn't loaded yet.
  useEffect(() => {
    const known = new Set(messagesRef.current.map((m) => m.id));
    const windowStart = oldestLoadedAt ? Date.parse(oldestLoadedAt) : null;
    const landed = Object.values(flights)
      .filter(
        (f) =>
          f.status === "delivered" &&
          f.sender_id !== currentUserId &&
          (windowStart === null || (f.arrival_time !== null && Date.parse(f.arrival_time) >= windowStart)) &&
          !known.has(f.message_id) &&
          !requestedLandedLetterIds.current.has(f.message_id)
      )
      .map((f) => f.message_id);
    if (landed.length === 0) return;
    landed.forEach((id) => requestedLandedLetterIds.current.add(id));

    const supabase = createClient();
    supabase
      .from("messages")
      .select("*")
      .in("id", landed)
      .then(({ data, error }) => {
        if (error) {
          landed.forEach((id) => requestedLandedLetterIds.current.delete(id));
          return;
        }
        isAtBottomRef.current = true;
        setMessages((prev) => {
          const have = new Set(prev.map((m) => m.id));
          const fresh = (data ?? []).filter((m) => !have.has(m.id));
          return fresh.length > 0 ? [...prev, ...fresh] : prev;
        });
      });
  }, [currentUserId, flights, oldestLoadedAt]);

  // Next older page of history, triggered by scrolling near the top.
  const loadOlder = useCallback(async () => {
    const before = oldestLoadedAtRef.current;
    if (!before || loadingOlderRef.current) return;
    loadingOlderRef.current = true;
    setLoadingOlder(true);
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("messages")
        .select("*")
        .eq("chat_id", chatId)
        .lt("created_at", before)
        .order("created_at", { ascending: false })
        .limit(CHAT_PAGE_SIZE + 1);
      if (error) {
        if (isSessionExpiredError(error)) redirectToLoginForExpiredSession();
        return;
      }
      const page = (data ?? []).slice(0, CHAT_PAGE_SIZE).reverse();
      setHasOlder((data ?? []).length > CHAT_PAGE_SIZE);
      if (page.length === 0) return;

      const windowStart = page[0].created_at;
      // Flights that landed inside the newly loaded stretch (older than the
      // previous window, so fetchFlights never asked for them).
      const flightsResult = await supabase
        .from("pigeon_flights")
        .select(FLIGHT_COLUMNS)
        .eq("chat_id", chatId)
        .gte("arrival_time", windowStart)
        .lt("arrival_time", before);
      if (!flightsResult.error) mergeFlights((flightsResult.data ?? []) as unknown as FlightRow[]);

      scrollHeightBeforePrependRef.current = scrollRef.current?.scrollHeight ?? null;
      setMessages((prev) => {
        const known = new Set(prev.map((m) => m.id));
        const fresh = page.filter((m) => !known.has(m.id));
        return fresh.length > 0 ? [...fresh, ...prev] : prev;
      });
      setOldestLoadedAt(windowStart);
    } finally {
      loadingOlderRef.current = false;
      setLoadingOlder(false);
    }
  }, [chatId, mergeFlights]);

  // Keep the message the user was looking at in place when older ones get
  // prepended above it.
  useLayoutEffect(() => {
    const previousHeight = scrollHeightBeforePrependRef.current;
    const el = scrollRef.current;
    if (previousHeight === null || !el) return;
    scrollHeightBeforePrependRef.current = null;
    el.scrollTop += el.scrollHeight - previousHeight;
  }, [messages]);

  // ONE realtime channel for the whole chat: new messages (RLS only
  // delivers what I may read — so no in-flight letters to me) and every
  // flight change in this chat.
  useEffect(() => {
    const supabase = createClient();
    let channel: ReturnType<typeof supabase.channel> | undefined;
    let cancelled = false;
    let hasSubscribedOnce = false;
    let hiddenSince: number | null = null;
    let resyncTimer: ReturnType<typeof setTimeout> | undefined;
    let resyncRunning = false;
    let resyncAgain = false;

    // All catch-up triggers (reconnect, back online, back from background)
    // go through here: bursts collapse into one resync (going back online
    // usually also means a realtime reconnect), and a resync never runs
    // twice in parallel — one requested meanwhile runs once afterwards.
    function scheduleResync() {
      if (resyncTimer) clearTimeout(resyncTimer);
      resyncTimer = setTimeout(async () => {
        if (cancelled) return;
        if (resyncRunning) {
          resyncAgain = true;
          return;
        }
        resyncRunning = true;
        try {
          await resync();
        } finally {
          resyncRunning = false;
          if (resyncAgain && !cancelled) {
            resyncAgain = false;
            scheduleResync();
          }
        }
      }, RESYNC_DEBOUNCE_MS);
    }

    // createClient()'s session is restored from cookies asynchronously; if
    // the channel subscribes before that finishes, "postgres_changes"
    // authorizes as anon and RLS silently drops every event. Awaiting
    // getSession() first is a cheap way to wait for that hydration.
    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      if (!data.session) {
        redirectToLoginForExpiredSession();
        return;
      }
      channel = supabase
        .channel(`chat-${chatId}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "pigeon",
            table: "messages",
            filter: `chat_id=eq.${chatId}`,
          },
          (payload) => appendServerMessages([payload.new as MessageRow])
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "pigeon",
            table: "pigeon_flights",
            filter: `chat_id=eq.${chatId}`,
          },
          (payload) => {
            if (payload.eventType === "DELETE") return;
            mergeFlights([payload.new as FlightRow]);
          }
        )
        .subscribe((status) => {
          // Every SUBSCRIBED after the first one is a reconnect — anything
          // sent in between never reached us as an event.
          if (status === "SUBSCRIBED") {
            if (hasSubscribedOnce) scheduleResync();
            hasSubscribedOnce = true;
          }
        });
    });

    // A short tab switch leaves the socket connected (and if it did drop,
    // the reconnect above resyncs anyway) — only a longer background
    // stretch is worth a catch-up query on its own.
    function handleVisibilityChange() {
      if (document.visibilityState === "hidden") {
        hiddenSince = Date.now();
        return;
      }
      if (hiddenSince !== null && Date.now() - hiddenSince > RESYNC_AFTER_HIDDEN_MS) scheduleResync();
      hiddenSince = null;
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("online", scheduleResync);

    return () => {
      cancelled = true;
      if (resyncTimer) clearTimeout(resyncTimer);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("online", scheduleResync);
      if (channel) supabase.removeChannel(channel);
    };
  }, [appendServerMessages, chatId, mergeFlights, resync]);

  // Both buckets are private, so image_url/audio_url only ever hold a
  // storage path ("{chatId}/{messageId}.ext"). Resolve them to signed URLs
  // — reused from lib/chat/signed-url-cache.ts while still valid, so the
  // browser cache can serve the files — and sign the rest in one batched
  // request per bucket. Failures are surfaced via attachmentLoadErrors
  // (with a manual retry in the UI) instead of failing silently.
  const fetchSignedUrls = useCallback(async (refs: StorageRef[]) => {
    const uniqueRefs = Array.from(new Map(refs.map((r) => [r.path, r])).values());
    const pending = uniqueRefs.filter(
      (r) => !requestedSignedUrlPaths.current.has(r.path)
    );
    if (pending.length === 0) return;
    pending.forEach((r) => requestedSignedUrlPaths.current.add(r.path));

    const cached: Record<string, string> = {};
    const toFetch: StorageRef[] = [];
    for (const r of pending) {
      const url = getCachedSignedUrl(currentUserId, r.path);
      if (url) cached[r.path] = url;
      else toFetch.push(r);
    }
    if (Object.keys(cached).length > 0) {
      setSignedUrls((prev) => ({ ...prev, ...cached }));
    }
    if (toFetch.length === 0) return;

    const supabase = createClient();
    await supabase.auth.getSession();

    const byBucket = new Map<string, string[]>();
    for (const r of toFetch) {
      byBucket.set(r.bucket, [...(byBucket.get(r.bucket) ?? []), r.path]);
    }

    const results: { path: string; url?: string; error?: string }[] = [];
    await Promise.all(
      Array.from(byBucket.entries()).map(async ([bucket, paths]) => {
        const { data, error } = await supabase.storage
          .from(bucket)
          .createSignedUrls(paths, SIGNED_URL_TTL_SECONDS);
        if (error) {
          if (isSessionExpiredError(error)) redirectToLoginForExpiredSession();
          paths.forEach((path) => results.push({ path, error: error.message }));
          return;
        }
        const returned = new Map((data ?? []).map((d) => [d.path, d]));
        for (const path of paths) {
          const entry = returned.get(path);
          results.push({
            path,
            url: entry?.signedUrl ?? undefined,
            error: entry?.error ?? undefined,
          });
        }
      })
    );

    cacheSignedUrls(
      currentUserId,
      results.flatMap((r) => (r.url ? [{ path: r.path, url: r.url }] : []))
    );
    setSignedUrls((prev) => {
      const next = { ...prev };
      for (const r of results) if (r.url) next[r.path] = r.url;
      return next;
    });
    setAttachmentLoadErrors((prev) => {
      const next = { ...prev };
      for (const r of results) {
        if (r.url) delete next[r.path];
        else next[r.path] = "Anhang konnte nicht geladen werden.";
      }
      return next;
    });
    // Allow a failed path to be picked up again, either by a manual retry
    // or the next time the messages array changes.
    results.forEach((r) => {
      if (!r.url) requestedSignedUrlPaths.current.delete(r.path);
    });
  }, [currentUserId]);

  // A signed URL that stops working (expired after SIGNED_URL_TTL_SECONDS
  // in a long-open tab) — drop it and fetch a fresh one.
  const refreshSignedUrl = useCallback(
    (ref: StorageRef) => {
      forgetSignedUrl(currentUserId, ref.path);
      setSignedUrls((prev) => {
        if (!prev[ref.path]) return prev;
        const next = { ...prev };
        delete next[ref.path];
        return next;
      });
      requestedSignedUrlPaths.current.delete(ref.path);
      void fetchSignedUrls([ref]);
    },
    [currentUserId, fetchSignedUrls]
  );

  useEffect(() => {
    const refs: StorageRef[] = [];
    for (const m of messages) {
      if (m.image_url && !requestedSignedUrlPaths.current.has(m.image_url)) {
        refs.push({ bucket: CHAT_IMAGE_BUCKET, path: m.image_url });
      }
      if (m.audio_url && !requestedSignedUrlPaths.current.has(m.audio_url)) {
        refs.push({ bucket: CHAT_VOICE_BUCKET, path: m.audio_url });
      }
      if (m.video_url && !requestedSignedUrlPaths.current.has(m.video_url)) {
        refs.push({ bucket: CHAT_VIDEO_BUCKET, path: m.video_url });
      }
    }
    if (refs.length > 0) fetchSignedUrls(refs);
  }, [messages, fetchSignedUrls]);

  const messagesById = useMemo(() => new Map(messages.map((m) => [m.id, m])), [messages]);

  // Replies quoting something older than the loaded window: fetch just
  // those originals by id (RLS decides whether I may read them).
  useEffect(() => {
    const missing = new Set<string>();
    for (const m of messages) {
      const id = m.reply_to_id;
      if (id && !messagesById.has(id) && !requestedQuotedIds.current.has(id)) missing.add(id);
    }
    if (missing.size === 0) return;
    const ids = Array.from(missing);
    ids.forEach((id) => requestedQuotedIds.current.add(id));

    const supabase = createClient();
    supabase
      .from("messages")
      .select("*")
      .in("id", ids)
      .then(({ data, error }) => {
        if (error) {
          ids.forEach((id) => requestedQuotedIds.current.delete(id));
          return;
        }
        const found = new Map((data ?? []).map((row) => [row.id, row]));
        setQuotedOutsideWindow((prev) => {
          const next = { ...prev };
          for (const id of ids) next[id] = found.get(id) ?? null;
          return next;
        });
      });
  }, [messages, messagesById]);

  function quoteInfoFor(quotedId: string): QuoteInfo {
    const quoted = messagesById.get(quotedId) ?? quotedOutsideWindow[quotedId];
    if (!quoted) {
      const flight = flights[quotedId];
      if (flight && flight.sender_id !== currentUserId && flight.status !== "delivered") {
        return { author: partnerName, preview: "🕊️ Brief ist noch unterwegs", unavailable: true };
      }
      return quoted === null
        ? { author: "Nachricht", preview: "Nachricht nicht mehr verfügbar", unavailable: true }
        : { author: "…", preview: "Wird geladen…", unavailable: true };
    }
    const preview = previewOf(quoted);
    return {
      author: quoted.sender_id === currentUserId ? "Du" : partnerName,
      preview: quoted.kind === "pigeon" ? `✉️ ${preview || "Brief"}` : preview,
    };
  }

  function startReply(message: DisplayMessage) {
    setReplyTo(message);
    setComposerError(null);
    composerRef.current?.focus();
  }

  // Scroll to a quoted message. Not loaded yet: load older pages one by
  // one until it shows up (or there's no older history left).
  useEffect(() => {
    if (!jumpTargetId) return;
    const el = scrollRef.current?.querySelector(`[data-message-id="${jumpTargetId}"]`);
    if (el) {
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      setHighlightedId(jumpTargetId);
      setJumpTargetId(null);
      return;
    }
    if (!hasOlder) {
      setJumpTargetId(null);
      return;
    }
    if (!loadingOlder) void loadOlder();
  }, [hasOlder, jumpTargetId, loadOlder, loadingOlder, messages]);

  useEffect(() => {
    if (!highlightedId) return;
    const timer = setTimeout(() => setHighlightedId(null), JUMP_HIGHLIGHT_MS);
    return () => clearTimeout(timer);
  }, [highlightedId]);

  // Letters to me appear at their *arrival* time (that's when they were
  // "delivered"), everything else at send time; incoming pigeons sit at
  // their departure time until they land and become the letter.
  const timeline = useMemo<TimelineItem[]>(() => {
    const items: TimelineItem[] = messages.map((message) => {
      const flight = flights[message.id];
      const sortAt =
        message.kind === "pigeon" && message.sender_id !== currentUserId && flight?.arrival_time
          ? Date.parse(flight.arrival_time)
          : Date.parse(message.created_at);
      return { type: "message", key: message.id, sortAt, message };
    });
    const known = new Set(messages.map((m) => m.id));
    for (const flight of Object.values(flights)) {
      if (
        flight.sender_id &&
        flight.sender_id !== currentUserId &&
        flight.status !== "delivered" &&
        !known.has(flight.message_id)
      ) {
        items.push({
          type: "incoming",
          key: `incoming-${flight.message_id}`,
          sortAt: flight.departure_time ? Date.parse(flight.departure_time) : now,
          flight,
        });
      }
    }
    return items.sort((a, b) => a.sortAt - b.sortAt);
  }, [currentUserId, flights, messages, now]);

  // Only items that show up after the first render get the entrance
  // animation — opening a chat doesn't make the whole history jump in.
  // A key once marked entering stays marked, so re-renders mid-animation
  // (upload progress, clock tick) don't cut it off.
  const seenTimelineKeysRef = useRef<Set<string> | null>(null);
  const enteringTimelineKeysRef = useRef(new Set<string>());
  if (!seenTimelineKeysRef.current) {
    seenTimelineKeysRef.current = new Set(timeline.map((item) => item.key));
  }
  for (const item of timeline) {
    if (!seenTimelineKeysRef.current.has(item.key)) {
      seenTimelineKeysRef.current.add(item.key);
      enteringTimelineKeysRef.current.add(item.key);
    }
  }

  useEffect(() => {
    if (isAtBottomRef.current) scrollToBottom();
  }, [timeline, scrollToBottom]);

  // Read state + "in view" for the server (unread badges, no push while
  // watching). See lib/chat/use-chat-read-state.ts.
  const { noteIncoming } = useChatReadState(chatId);

  // "Neue Nachrichten" line above the first partner message newer than
  // what was read before opening. Settled once the flights are in (a
  // landed letter sorts by its arrival time), then it stays put.
  const readBeforeOpening = useRef(initialLastReadAt ? Date.parse(initialLastReadAt) : null).current;
  const liveFirstUnreadKey = useMemo(() => {
    if (readBeforeOpening === null) return null;
    return (
      timeline.find((item) => isPartnerMessage(item, currentUserId) && item.sortAt > readBeforeOpening)?.key ?? null
    );
  }, [currentUserId, readBeforeOpening, timeline]);
  const [settledFirstUnreadKey, setSettledFirstUnreadKey] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    if (!flightsLoading && settledFirstUnreadKey === undefined) setSettledFirstUnreadKey(liveFirstUnreadKey);
  }, [flightsLoading, liveFirstUnreadKey, settledFirstUnreadKey]);
  const firstUnreadKey = settledFirstUnreadKey === undefined ? liveFirstUnreadKey : settledFirstUnreadKey;

  // Partner messages arriving while the chat is open: marked read (if in
  // view), and counted for the "n neue Nachrichten" button while scrolled
  // up. Only messages newer than everything shown so far count — older
  // pages loaded by scrolling up don't.
  const [unseenBelow, setUnseenBelow] = useState(0);
  const newestShownAtRef = useRef<number | null>(null);
  useEffect(() => {
    if (flightsLoading) return;
    const previousNewest = newestShownAtRef.current;
    let newest = previousNewest ?? -Infinity;
    let arrived = 0;
    for (const item of timeline) {
      if (item.type !== "message") continue;
      if (item.sortAt > newest) newest = item.sortAt;
      if (previousNewest !== null && item.sortAt > previousNewest && isPartnerMessage(item, currentUserId)) {
        arrived += 1;
      }
    }
    newestShownAtRef.current = newest;
    if (arrived === 0) return;
    noteIncoming();
    if (!isAtBottomRef.current) setUnseenBelow((count) => count + arrived);
  }, [currentUserId, flightsLoading, noteIncoming, timeline]);

  function jumpToNewest() {
    isAtBottomRef.current = true;
    scrollToBottom();
    setUnseenBelow(0);
  }

  function handleScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    isAtBottomRef.current = distanceFromBottom < BOTTOM_THRESHOLD_PX;
    if (isAtBottomRef.current && unseenBelow > 0) setUnseenBelow(0);
    if (el.scrollTop < LOAD_OLDER_THRESHOLD_PX && hasOlder) void loadOlder();
  }

  function handleMediaLoaded() {
    // An image finishing to load grows its bubble; stay pinned if we were.
    if (isAtBottomRef.current) scrollToBottom();
  }

  // Any size and (almost) any format: images and videos are shrunk on
  // the device right before the upload (see performSend / lib/media).
  // Type detection falls back to the file extension: HEIC photos, for
  // one, often arrive without a MIME type.
  function setFileAttachment(file: File) {
    setComposerError(null);
    if (looksLikeVideo(file)) {
      setAttachment({ kind: "video", file, previewUrl: createObjectUrl(file) });
    } else if (looksLikeImage(file)) {
      setAttachment({ kind: "image", file, previewUrl: createObjectUrl(file) });
    } else {
      setComposerError("Nur Bilder und Videos können verschickt werden.");
    }
  }

  function handleFileInputChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) setFileAttachment(file);
    event.target.value = "";
  }

  function handlePaste(event: ClipboardEvent<HTMLElement>) {
    const file = Array.from(event.clipboardData.files).find((f) => looksLikeImage(f) || looksLikeVideo(f));
    if (!file) return;
    event.preventDefault();
    setFileAttachment(file);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragOver(false);
    const file = event.dataTransfer.files[0];
    if (file) setFileAttachment(file);
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragOver(true);
  }

  function handleDragLeave(event: DragEvent<HTMLDivElement>) {
    if (event.currentTarget.contains(event.relatedTarget as Node)) return;
    setIsDragOver(false);
  }

  function removeAttachment() {
    // Only drop the reference here — the object URL itself is revoked on
    // unmount, since a just-sent message may still be showing it.
    setAttachment(null);
  }

  function handleVoiceRecorded(result: RecordedVoice) {
    setComposerError(null);
    setAttachment({
      kind: "voice",
      blob: result.blob,
      previewUrl: createObjectUrl(result.blob),
      durationSeconds: result.durationSeconds,
      mimeType: result.mimeType,
    });
  }

  function updateMessage(id: string, patch: Partial<DisplayMessage>) {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  }

  function updateUploadProgress(id: string, fraction: number) {
    updateMessage(id, { uploadProgress: Math.round(fraction * 100) });
  }

  // Shared by the initial send and by "Erneut versuchen" (retry), so both
  // paths go through the exact same upload + insert logic and leave the
  // message bubble in a consistent state. Resolves true once the message
  // row exists on the server.
  async function performSend(
    id: string,
    text: string | null,
    attachmentToSend: PendingAttachment | null,
    kind: MessageKind,
    replyToId: string | null
  ): Promise<boolean> {
    const supabase = createClient();
    let imagePath: string | null = null;
    let audioPath: string | null = null;
    let videoPath: string | null = null;
    let audioDuration: number | null = null;

    updateMessage(id, {
      uploadError: undefined,
      uploadProgress: attachmentToSend ? 0 : undefined,
      uploadPhase: attachmentToSend && attachmentToSend.kind !== "voice" ? "processing" : "uploading",
    });

    if (attachmentToSend) {
      try {
        // getSession() also refreshes an expired access token; if that
        // fails there's no session left to upload with.
        const { data: sessionData } = await supabase.auth.getSession();
        const accessToken = sessionData.session?.access_token;
        if (!accessToken) {
          redirectToLoginForExpiredSession();
          return false;
        }

        if (attachmentToSend.kind === "image" || attachmentToSend.kind === "video") {
          const isVideo = attachmentToSend.kind === "video";
          const processed = isVideo
            ? await processVideo(attachmentToSend.file, (fraction) => updateUploadProgress(id, fraction))
            : await compressChatImage(attachmentToSend.file);
          updateMessage(id, { uploadPhase: "uploading", uploadProgress: 0 });
          const path = buildChatAttachmentPath(chatId, id, processed.extension);
          // Processing a long video can take minutes; getSession() hands
          // out a refreshed token if the first one expired meanwhile.
          const { data: freshSession } = await supabase.auth.getSession();
          await uploadToBucket({
            supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
            apiKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
            accessToken: freshSession.session?.access_token ?? accessToken,
            bucket: isVideo ? CHAT_VIDEO_BUCKET : CHAT_IMAGE_BUCKET,
            path,
            file: processed.blob,
            contentType: processed.contentType,
            onProgress: (fraction) => updateUploadProgress(id, fraction),
          });
          if (isVideo) videoPath = path;
          else imagePath = path;
        } else {
          const path = buildChatVoicePath(chatId, id, attachmentToSend.mimeType);
          const contentType = baseMimeType(attachmentToSend.mimeType);
          await uploadToBucket({
            supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
            apiKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
            accessToken,
            bucket: CHAT_VOICE_BUCKET,
            path,
            file: attachmentToSend.blob,
            contentType,
            onProgress: (fraction) => updateUploadProgress(id, fraction),
          });
          audioPath = path;
          audioDuration = Math.round(attachmentToSend.durationSeconds);
        }
      } catch (error) {
        if (error instanceof ChatUploadError && error.status === 401) {
          redirectToLoginForExpiredSession();
          return false;
        }
        const message =
          typeof navigator !== "undefined" && !navigator.onLine
            ? "Keine Internetverbindung. Upload fehlgeschlagen."
            : error instanceof ChatUploadError
              ? error.message
              : error instanceof VideoTooLargeError
                ? error.message === "unsupported"
                  ? "Dieser Browser kann das Video nicht verkleinern. Bitte Browser aktualisieren oder anderes Gerät nutzen."
                  : "Video ist zu lang (über ca. 1,5 Std.), um es klein genug zu rechnen."
                : "Upload fehlgeschlagen. Bitte erneut versuchen.";
        updateMessage(id, { uploadError: message, uploadProgress: undefined });
        return false;
      }
    }

    // For a pigeon letter this insert is also what launches the flight
    // (server-side trigger -> start-pigeon-flight).
    const { error } = await supabase.from("messages").insert({
      id,
      chat_id: chatId,
      sender_id: currentUserId,
      kind,
      content: text,
      image_url: imagePath,
      audio_url: audioPath,
      audio_duration_seconds: audioDuration,
      video_url: videoPath,
      reply_to_id: replyToId,
    });

    // 23505 = this id already exists: an earlier attempt did reach the
    // server, only its response got lost. That's a success, not a failure.
    if (error && error.code !== "23505") {
      if (isSessionExpiredError(error)) {
        redirectToLoginForExpiredSession();
        return false;
      }
      console.error("Failed to send message:", error.message);
      updateMessage(id, { uploadError: sendErrorMessage(), uploadProgress: undefined });
      return false;
    }

    // Local preview stays around as a fallback source until the signed URL
    // for the real upload resolves, so the bubble never flashes a broken
    // image/player right after a successful send.
    updateMessage(id, {
      pending: false,
      image_url: imagePath,
      audio_url: audioPath,
      audio_duration_seconds: audioDuration,
      video_url: videoPath,
      uploadProgress: undefined,
      uploadError: undefined,
      pendingAttachment: undefined,
    });
    return true;
  }

  function submitMessage() {
    const text = draft.trim();
    const attachmentToSend = attachment;
    if (!text && !attachmentToSend) return;
    const kind = mode;
    const replyToId = replyTo?.id ?? null;

    // First thing, while still inside the submit gesture (iOS only allows
    // audio started directly from one). Chat: the terminal "boot" chime
    // under the hacker show; letter: the take-off whoosh.
    if (kind === "chat") playEncryptStart();
    else playPigeonTakeoff();

    setDraft("");
    setAttachment(null);
    setReplyTo(null);

    const id = crypto.randomUUID();
    const optimisticMessage: DisplayMessage = {
      id,
      chat_id: chatId,
      sender_id: currentUserId,
      kind,
      content: text || null,
      image_url: null,
      audio_url: null,
      audio_duration_seconds: null,
      video_url: null,
      reply_to_id: replyToId,
      created_at: new Date().toISOString(),
      pending: true,
      ...(attachmentToSend
        ? {
            uploadProgress: 0,
            pendingAttachment: attachmentToSend,
            ...(attachmentToSend.kind === "image"
              ? { localImagePreview: attachmentToSend.previewUrl }
              : attachmentToSend.kind === "video"
              ? { localVideoPreview: attachmentToSend.previewUrl }
              : {
                  localAudioPreview: attachmentToSend.previewUrl,
                  audio_duration_seconds: attachmentToSend.durationSeconds,
                }),
          }
        : {}),
    };

    isAtBottomRef.current = true;
    setMessages((prev) => [...prev, optimisticMessage]);

    if (kind === "chat") {
      // Instant chat: the message goes out right away in the background
      // (the recipient has it immediately); the sender sees the bubble at
      // once, with the hacker show playing in the chat background.
      setEncryptingId(id);
      void performSend(id, text || null, attachmentToSend, "chat", replyToId);
      return;
    }

    // Pigeon letter: no hacker show — straight to the flight map once the
    // letter is actually handed over. The map shows its own "getting
    // ready" state until the flight row arrives a beat later. Back to
    // chat mode afterwards: letters are the deliberate exception.
    setMode("chat");
    void performSend(id, text || null, attachmentToSend, "pigeon", replyToId).then((ok) => {
      if (ok) setOpenFlightMessageId(id);
    });
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    submitMessage();
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Escape" && replyTo) {
      event.preventDefault();
      setReplyTo(null);
      return;
    }
    // isComposing: Enter that confirms an IME/autocorrect suggestion.
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
    // Ctrl/Cmd+Enter always sends. Otherwise Enter makes a new line in a
    // letter and on touch screens, and sends a chat message on desktop.
    const sends =
      event.ctrlKey || event.metaKey || (!isLetterMode && !event.shiftKey && sendsOnEnterRef.current);
    if (!sends) return;
    event.preventDefault();
    submitMessage();
  }

  const handleEncryptionComplete = useCallback((id: string) => {
    setEncryptingId((current) => (current === id ? null : current));
  }, []);

  // A failed send ends the show right away — the bubble shows the error
  // and retry button instead.
  const encryptingFailed = encryptingId
    ? messages.some((m) => m.id === encryptingId && !!m.uploadError)
    : false;
  useEffect(() => {
    if (encryptingFailed) setEncryptingId(null);
  }, [encryptingFailed]);

  function retrySend(message: DisplayMessage) {
    void performSend(
      message.id,
      message.content,
      message.pendingAttachment ?? null,
      message.kind,
      message.reply_to_id
    ).then(
      (ok) => {
        if (ok && message.kind === "pigeon") setOpenFlightMessageId(message.id);
      }
    );
  }

  const closeFlightMap = useCallback(() => setOpenFlightMessageId(null), []);
  const closeLightbox = useCallback(() => setLightboxSrc(null), []);
  const closeVideoLightbox = useCallback(() => setVideoLightboxSrc(null), []);

  const hasSendableContent = !!draft.trim() || !!attachment;
  const isLetterMode = mode === "pigeon";

  useEffect(() => {
    sendsOnEnterRef.current = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  }, []);

  // Grow the composer with its content (scrollHeight excludes the 1px
  // borders, height includes them), scrolling only past the max height.
  const resizeComposer = useCallback(() => {
    const el = composerRef.current;
    if (!el) return;
    const max = COMPOSER_MAX_HEIGHT_PX[isLetterMode ? "pigeon" : "chat"];
    el.style.height = "auto";
    const needed = el.scrollHeight + 2;
    el.style.height = `${Math.min(needed, max)}px`;
    el.style.overflowY = needed > max ? "auto" : "hidden";
  }, [isLetterMode]);

  useLayoutEffect(resizeComposer, [draft, resizeComposer]);

  useEffect(() => {
    window.addEventListener("resize", resizeComposer);
    return () => window.removeEventListener("resize", resizeComposer);
  }, [resizeComposer]);

  // Drafts: restored after mount (localStorage isn't there during SSR),
  // saved on every change. Storage can be unavailable — then no drafts.
  const draftRestoredRef = useRef(false);
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(draftStorageKey(currentUserId, chatId));
      if (saved) setDraft((current) => current || saved);
    } catch {}
    draftRestoredRef.current = true;
  }, [chatId, currentUserId]);

  useEffect(() => {
    if (!draftRestoredRef.current) return;
    try {
      const key = draftStorageKey(currentUserId, chatId);
      if (draft) window.localStorage.setItem(key, draft);
      else window.localStorage.removeItem(key);
    } catch {}
  }, [chatId, currentUserId, draft]);
  const openFlight = openFlightMessageId ? flights[openFlightMessageId] : undefined;
  const openFlightIsMine = openFlight
    ? openFlight.sender_id === currentUserId
    : messages.some((m) => m.id === openFlightMessageId && m.sender_id === currentUserId);

  function renderMessage(message: DisplayMessage) {
    const isOwn = message.sender_id === currentUserId;
    const isLetter = message.kind === "pigeon";
    const imageSrc =
      (message.image_url && signedUrls[message.image_url]) || message.localImagePreview;
    const audioSrc =
      (message.audio_url && signedUrls[message.audio_url]) || message.localAudioPreview;
    const videoSrc =
      (message.video_url && signedUrls[message.video_url]) || message.localVideoPreview;
    const videoLoadError = message.video_url ? attachmentLoadErrors[message.video_url] : undefined;
    const isUploading = message.uploadProgress !== undefined;
    const hasError = !!message.uploadError;
    const imageLoadError = message.image_url ? attachmentLoadErrors[message.image_url] : undefined;
    const audioLoadError = message.audio_url ? attachmentLoadErrors[message.audio_url] : undefined;
    // Letters render on parchment for both sides; chat bubbles use my
    // accent color (or the default dark bubble) vs. neutral for others.
    const playerVariant = isOwn && !isLetter ? "own" : "other";

    const bubbleClass = isLetter
      ? "border border-[#d8c9a3] bg-[#f7f0df] text-[#3d3024] shadow-sm dark:border-night-border dark:bg-[#2a231b] dark:text-night-text"
      : isOwn
        ? "bg-bubble text-white"
        : "bg-neutral-100 text-neutral-900 dark:bg-night-raised dark:text-night-text";

    const isEncrypting = message.id === encryptingId && !hasError;
    const bubble = (
        <div
          className={`min-w-0 space-y-1 break-words rounded-2xl px-3 py-2 text-sm ${bubbleClass} ${
            message.pending && !hasError ? "opacity-60" : ""
          }`}
        >
          {isLetter && (
            <p className="font-serif text-xs italic opacity-70">
              ✉️ {isOwn ? `Brief an ${partnerName}` : `Brief von ${partnerName}`}
            </p>
          )}
          {message.reply_to_id && (() => {
            const quotedId = message.reply_to_id;
            const quote = quoteInfoFor(quotedId);
            return (
              <ReplyQuote
                quote={quote}
                variant={isLetter ? "letter" : isOwn ? "own" : "other"}
                onClick={quote.unavailable ? undefined : () => setJumpTargetId(quotedId)}
              />
            );
          })()}
          {imageSrc && (
            <div className="relative w-60 max-w-full overflow-hidden rounded-xl">
              <ChatImage
                src={imageSrc}
                interactive={!isUploading && !hasError}
                onOpen={() => setLightboxSrc(imageSrc)}
                onLoad={handleMediaLoaded}
                onError={() => {
                  if (message.image_url && signedUrls[message.image_url]) {
                    refreshSignedUrl({ bucket: CHAT_IMAGE_BUCKET, path: message.image_url });
                  }
                }}
              />
              {isUploading && !hasError && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                  <div className="h-1.5 w-2/3 overflow-hidden rounded-full bg-white/30">
                    <div
                      className={`h-full bg-white transition-all ${
                        message.uploadPhase === "processing" ? "animate-pulse" : ""
                      }`}
                      style={{ width: `${message.uploadPhase === "processing" ? 100 : message.uploadProgress}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          )}
          {videoSrc && (
            <div className="relative w-60 max-w-full overflow-hidden rounded-xl bg-black">
              <ChatVideo
                src={videoSrc}
                interactive={!isUploading || hasError}
                onOpen={() => setVideoLightboxSrc(videoSrc)}
                onLoaded={handleMediaLoaded}
                onError={() => {
                  if (message.video_url && signedUrls[message.video_url]) {
                    refreshSignedUrl({ bucket: CHAT_VIDEO_BUCKET, path: message.video_url });
                  }
                }}
              />
              {isUploading && !hasError && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/50 text-xs text-white">
                  <span>{message.uploadPhase === "processing" ? "Video wird verkleinert…" : "Wird hochgeladen…"}</span>
                  <div className="h-1.5 w-2/3 overflow-hidden rounded-full bg-white/30">
                    <div
                      className="h-full bg-white transition-all"
                      style={{ width: `${message.uploadProgress}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          )}
          {!videoSrc && message.video_url && (
            videoLoadError ? (
              <div className="flex w-60 max-w-full flex-col items-center gap-2 rounded-xl border border-dashed border-neutral-300 p-4 text-center dark:border-night-border">
                <span className="text-xs opacity-70">{videoLoadError}</span>
                <button
                  type="button"
                  onClick={() => fetchSignedUrls([{ bucket: CHAT_VIDEO_BUCKET, path: message.video_url! }])}
                  className="text-xs font-medium underline"
                >
                  Erneut versuchen
                </button>
              </div>
            ) : (
              <Skeleton className="h-40 w-60 max-w-full rounded-xl" />
            )
          )}
          {!imageSrc && message.image_url && (
            imageLoadError ? (
              <div className="flex w-60 max-w-full flex-col items-center gap-2 rounded-xl border border-dashed border-neutral-300 p-4 text-center dark:border-night-border">
                <span className="text-xs opacity-70">{imageLoadError}</span>
                <button
                  type="button"
                  onClick={() => fetchSignedUrls([{ bucket: CHAT_IMAGE_BUCKET, path: message.image_url! }])}
                  className="text-xs font-medium underline"
                >
                  Erneut versuchen
                </button>
              </div>
            ) : (
              <Skeleton className="h-40 w-60 max-w-full rounded-xl" />
            )
          )}
          {audioSrc && (
            <div>
              <VoiceMessagePlayer
                src={audioSrc}
                durationSeconds={message.audio_duration_seconds}
                variant={playerVariant}
                onError={() => {
                  if (message.audio_url && signedUrls[message.audio_url]) {
                    refreshSignedUrl({ bucket: CHAT_VOICE_BUCKET, path: message.audio_url });
                  }
                }}
              />
              {isUploading && !hasError && (
                <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-current/20">
                  <div
                    className="h-full bg-current transition-all"
                    style={{ width: `${message.uploadProgress}%` }}
                  />
                </div>
              )}
            </div>
          )}
          {!audioSrc && message.audio_url && (
            audioLoadError ? (
              <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-neutral-300 p-4 text-center dark:border-night-border">
                <span className="text-xs opacity-70">{audioLoadError}</span>
                <button
                  type="button"
                  onClick={() => fetchSignedUrls([{ bucket: CHAT_VOICE_BUCKET, path: message.audio_url! }])}
                  className="text-xs font-medium underline"
                >
                  Erneut versuchen
                </button>
              </div>
            ) : (
              <div className="flex min-w-[180px] items-center gap-2" aria-label="Sprachnachricht wird geladen">
                <Skeleton className="h-8 w-8 flex-shrink-0 rounded-full" />
                <Skeleton className="h-1.5 flex-1 rounded-full" />
                <Skeleton className="h-3 w-8" />
              </div>
            )
          )}
          {message.content && (
            <p className={`whitespace-pre-wrap ${isLetter ? "font-serif text-[15px] leading-relaxed" : ""}`}>
              {message.content}
            </p>
          )}
          {hasError && (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1" role="alert">
              <span className="text-xs opacity-80">⚠️ {message.uploadError}</span>
              <button
                type="button"
                onClick={() => retrySend(message)}
                className="rounded-full bg-black/10 px-2 py-0.5 text-xs font-medium underline-offset-2 hover:underline dark:bg-white/15"
              >
                Erneut versuchen
              </button>
            </div>
          )}
          {isEncrypting && !isUploading ? (
            <span className="block font-mono text-[11px] opacity-70">🔐 Wird verschlüsselt…</span>
          ) : (
            message.pending &&
            !hasError &&
            !isUploading && (
              <span className="text-xs opacity-70">
                {isLetter ? "Brief wird übergeben…" : "Wird gesendet…"}
              </span>
            )
          )}
          {isLetter && !message.pending && !hasError && (
            <PigeonStatusBadge
              flight={flights[message.id]}
              loading={flightsLoading}
              onOpen={() => setOpenFlightMessageId(message.id)}
            />
          )}
        </div>
    );

    return (
      <ReplyableRow isOwn={isOwn} enabled={!message.pending && !hasError} onReply={() => startReply(message)}>
        {bubble}
      </ReplyableRow>
    );
  }

  function renderIncoming(flight: FlightRow) {
    const remaining = formatRemainingShort(flight.arrival_time, now);
    return (
      <div className="flex justify-start">
        <button
          type="button"
          onClick={() => setOpenFlightMessageId(flight.message_id)}
          className="max-w-[80%] space-y-1 rounded-2xl border border-dashed border-[#d8c9a3] bg-[#f7f0df]/60 px-3 py-2 text-left text-sm text-[#5c4a37] hover:bg-[#f7f0df] sm:max-w-[75%] dark:border-night-border dark:bg-night-surface dark:text-night-text dark:hover:bg-night-raised"
        >
          <p className="font-medium">
            <span className="pigeon-wing inline-block">🕊️</span> {partnerPigeonName} bringt dir einen Brief
          </p>
          <p className="text-xs opacity-70">
            {flight.status === "in_transit"
              ? `Unterwegs${remaining ? ` · ${remaining}` : ""} · Flug verfolgen`
              : "Macht sich startklar…"}
          </p>
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <PushPermissionPrompt userId={currentUserId} />
      {/* The hacker show plays behind the messages, not over them. */}
      <div className="relative min-h-0 flex-1">
        <CodeRain />
        <AnimatePresence>
          {encryptingId && (
            <EncryptionBackdrop
              key={encryptingId}
              onComplete={() => handleEncryptionComplete(encryptingId)}
            />
          )}
        </AnimatePresence>
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="relative h-full space-y-2 overflow-y-auto overflow-x-hidden overscroll-contain px-4 py-4"
        >
          {hasOlder && (
            <div className="flex justify-center py-1">
              <button
                type="button"
                onClick={() => void loadOlder()}
                disabled={loadingOlder}
                className="rounded-full px-3 py-1 text-xs text-neutral-400 hover:bg-neutral-100 disabled:hover:bg-transparent dark:text-night-muted dark:hover:bg-night-raised"
              >
                {loadingOlder ? "Ältere Nachrichten werden geladen…" : "Ältere Nachrichten laden"}
              </button>
            </div>
          )}
          {timeline.length === 0 && (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-sm text-neutral-400 dark:text-night-muted">
              <span className="text-3xl">🕊️</span>
              <p>Noch keine Nachrichten. Schreib {partnerName} — oder schick gleich eine Taube!</p>
            </div>
          )}
          {timeline.map((item) => (
            <div
              key={item.key}
              data-message-id={item.type === "message" ? item.message.id : undefined}
              className={`-mx-2 rounded-2xl px-2 transition-colors duration-700 ${
                enteringTimelineKeysRef.current.has(item.key) ? "animate-message-in" : ""
              } ${item.key === highlightedId ? "bg-[#c1643a]/15 dark:bg-night-accent/20" : ""}`}
            >
              {item.key === firstUnreadKey && <UnreadDivider />}
              {item.type === "message" ? renderMessage(item.message) : renderIncoming(item.flight)}
            </div>
          ))}
        </div>
        <NewMessagesButton count={unseenBelow} onClick={jumpToNewest} />
      </div>
      <div
        className={`border-t p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] transition-colors ${
          isLetterMode
            ? "border-[#d8c9a3] bg-[#f7f0df] dark:border-night-border dark:bg-[#2a231b]"
            : "border-neutral-200 dark:border-night-border"
        } ${isDragOver ? "bg-neutral-50 dark:bg-night-surface" : ""}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {isLetterMode && (
          <div className="mb-2 flex items-center justify-between gap-2 text-xs text-[#8a7a5c] dark:text-night-muted">
            <span>
              ✉️ Brief an {partnerName} — {myPigeonName} fliegt ihn hin. Erst nach der Landung kann{" "}
              {partnerName} ihn lesen.
            </span>
            <button
              type="button"
              onClick={() => setMode("chat")}
              className="flex-shrink-0 underline"
            >
              Abbrechen
            </button>
          </div>
        )}
        {composerError && (
          <div className="mb-2 flex items-start justify-between gap-2 rounded-xl border border-red-200 bg-red-50 p-2 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
            <span>{composerError}</span>
            <button
              type="button"
              onClick={() => setComposerError(null)}
              aria-label="Hinweis schließen"
              className="flex-shrink-0 text-red-400 hover:text-red-600"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}
        <AvailabilityHint schedule={partnerSchedule} partnerName={partnerName} />
        {replyTo && (
          <ReplyComposerPreview
            title={replyTo.sender_id === currentUserId ? "Antwort auf deine Nachricht" : `Antwort an ${partnerName}`}
            preview={quoteInfoFor(replyTo.id).preview}
            onCancel={() => setReplyTo(null)}
          />
        )}
        {attachment && (
          <div className="mb-2 flex items-center gap-2 rounded-xl border border-neutral-200 bg-neutral-50 p-2 dark:border-night-border dark:bg-night-surface">
            {attachment.kind === "video" ? (
              <>
                <video
                  src={attachment.previewUrl}
                  muted
                  playsInline
                  preload="metadata"
                  className="h-12 w-12 rounded-lg bg-black object-cover"
                />
                <span className="flex-1 truncate text-xs text-neutral-500 dark:text-night-muted">
                  🎬 {attachment.file.name}
                </span>
              </>
            ) : attachment.kind === "image" ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={attachment.previewUrl}
                  alt="Ausgewähltes Bild"
                  className="h-12 w-12 rounded-lg object-cover"
                />
                <span className="flex-1 truncate text-xs text-neutral-500 dark:text-night-muted">
                  {attachment.file.name}
                </span>
              </>
            ) : (
              <div className="min-w-0 flex-1">
                <VoiceMessagePlayer
                  src={attachment.previewUrl}
                  durationSeconds={attachment.durationSeconds}
                  variant="other"
                />
              </div>
            )}
            <button
              type="button"
              onClick={removeAttachment}
              aria-label="Anhang entfernen"
              className="flex-shrink-0 rounded-full p-1 text-neutral-500 hover:bg-neutral-200 dark:text-night-muted dark:hover:bg-night-raised"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                className="h-4 w-4"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}
        <form onSubmit={handleSubmit} className="flex items-end gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,video/*,.heic,.heif"
            onChange={handleFileInputChange}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            aria-label="Bild oder Video anhängen"
            className="flex-shrink-0 rounded-full p-2 text-neutral-500 hover:bg-neutral-100 dark:text-night-muted dark:hover:bg-night-raised"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              className="h-5 w-5"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M21.44 11.05 12.25 20.24a5 5 0 0 1-7.07-7.07l8.49-8.49a3.5 3.5 0 0 1 4.95 4.95l-8.49 8.49a2 2 0 0 1-2.83-2.83l7.78-7.78"
              />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => {
              setMode(isLetterMode ? "chat" : "pigeon");
              composerRef.current?.focus();
            }}
            aria-pressed={isLetterMode}
            aria-label={isLetterMode ? "Zurück zum normalen Chat" : "Stattdessen per Brieftaube schicken"}
            title={isLetterMode ? "Normaler Chat" : "Per Brieftaube schicken"}
            className={`flex-shrink-0 rounded-full p-2 text-lg leading-none transition-colors ${
              isLetterMode
                ? "bg-[#c1643a] text-white"
                : "text-neutral-500 hover:bg-neutral-100 dark:text-night-muted dark:hover:bg-night-raised"
            }`}
          >
            🕊️
          </button>
          {/* text-base (16px) on phones: anything smaller makes iOS Safari
              zoom the whole page in when the field gets focus. One
              textarea for both modes, so switching keeps focus and text. */}
          <textarea
            ref={composerRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onPaste={handlePaste}
            onKeyDown={handleComposerKeyDown}
            rows={isLetterMode ? 3 : 1}
            enterKeyHint={isLetterMode ? "enter" : "send"}
            aria-label={isLetterMode ? `Brief an ${partnerName}` : "Nachricht"}
            placeholder={isLetterMode ? `Liebe/r ${partnerName}, …` : "Nachricht schreiben…"}
            className={`min-w-0 flex-1 resize-none overflow-hidden border px-4 py-1.5 text-base leading-6 sm:text-sm sm:leading-6 ${
              isLetterMode
                ? "rounded-xl border-[#d8c9a3] font-serif dark:border-night-border"
                : "rounded-[1.25rem] border-neutral-300 dark:border-night-border"
            }`}
          />
          {hasSendableContent ? (
            <button
              type="submit"
              // Keeps the focus (and the phone keyboard) in the text field.
              onMouseDown={(event) => event.preventDefault()}
              aria-label={isLetterMode ? "Losfliegen" : "Senden"}
              className={`flex-shrink-0 rounded-full text-sm ${
                isLetterMode ? "bg-[#c1643a] px-4 py-2 text-white" : "bg-accent p-2 text-on-accent"
              }`}
            >
              {isLetterMode ? (
                "Losfliegen"
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 12 3.27 3.13a59.77 59.77 0 0 1 18.22 8.87 59.77 59.77 0 0 1-18.22 8.88L6 12Zm0 0h7.5" />
                </svg>
              )}
            </button>
          ) : (
            <VoiceRecorderButton
              onRecorded={handleVoiceRecorded}
              onError={setComposerError}
            />
          )}
        </form>
      </div>
      {lightboxSrc && <ImageLightbox src={lightboxSrc} onClose={closeLightbox} />}
      {videoLightboxSrc && <VideoLightbox src={videoLightboxSrc} onClose={closeVideoLightbox} />}
      <AnimatePresence>
        {openFlightMessageId && (
          <PigeonFlightMap
            key={openFlightMessageId}
            flight={openFlight}
            loading={flightsLoading}
            onClose={closeFlightMap}
            pigeonName={openFlightIsMine ? myPigeonName : partnerPigeonName}
            routeLabel={openFlightIsMine ? `zu ${partnerName}` : `von ${partnerName}`}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
