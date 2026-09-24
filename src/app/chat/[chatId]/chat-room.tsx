"use client";

import {
  useCallback,
  useEffect,
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
  buildChatImagePath,
  compressChatImage,
} from "@/lib/chat/image-upload";
import {
  CHAT_VOICE_BUCKET,
  baseMimeType,
  buildChatVoicePath,
} from "@/lib/chat/voice-recording";
import { FLIGHT_COLUMNS, type FlightRow } from "@/lib/chat/flights";
import { playEncryptEnd, playEncryptStart } from "@/lib/chat/chime-sounds";
import {
  isSessionExpiredError,
  redirectToLoginForExpiredSession,
} from "@/lib/auth/session-expiry";
import { displayNameOf, pigeonNameOf, type MemberProfile } from "@/lib/profile";
import { ImageLightbox } from "@/components/chat/image-lightbox";
import { VoiceMessagePlayer } from "@/components/chat/voice-message-player";
import { VoiceRecorderButton, type RecordedVoice } from "@/components/chat/voice-recorder-button";
import { EncryptionSequence } from "@/components/chat/encryption-sequence";
import { PigeonFlightMap } from "@/components/chat/pigeon-flight-map";
import { PigeonStatusBadge } from "@/components/chat/pigeon-status-badge";
import { PushPermissionPrompt } from "@/components/push/push-permission-prompt";
import { Skeleton } from "@/components/ui/skeleton";

type MessageRow = Database["pigeon"]["Tables"]["messages"]["Row"];

type PendingAttachment =
  | { kind: "image"; file: File; previewUrl: string }
  | { kind: "voice"; blob: Blob; previewUrl: string; durationSeconds: number; mimeType: string };

type DisplayMessage = MessageRow & {
  pending?: boolean;
  // Present (0-100) while an attachment is uploading; undefined once the
  // message is fully sent or before any attachment finishes.
  uploadProgress?: number;
  uploadError?: string;
  // Local object URLs, kept around so we can show an instant preview and
  // support "retry" without re-picking the file / re-recording.
  localImagePreview?: string;
  localAudioPreview?: string;
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
  initialMessages: MessageRow[];
}

interface StorageRef {
  bucket: string;
  path: string;
}

// How close to the bottom (px) still counts as "at the bottom" for
// deciding whether to auto-scroll on new messages.
const BOTTOM_THRESHOLD_PX = 80;
const SIGNED_URL_TTL_SECONDS = 60 * 60;

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

export function ChatRoom({ chatId, me, partner, initialMessages }: ChatRoomProps) {
  const currentUserId = me.id;
  const [messages, setMessages] = useState<DisplayMessage[]>(initialMessages);
  const [flights, setFlights] = useState<Record<string, FlightRow>>({});
  const [flightsLoading, setFlightsLoading] = useState(true);
  const [mode, setMode] = useState<MessageKind>("chat");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [attachment, setAttachment] = useState<PendingAttachment | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});
  const [attachmentLoadErrors, setAttachmentLoadErrors] = useState<Record<string, string>>({});
  const [micError, setMicError] = useState<string | null>(null);
  const [showEncryption, setShowEncryption] = useState(false);
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

  const partnerName = displayNameOf(partner);
  const myPigeonName = pigeonNameOf(me);
  const partnerPigeonName = pigeonNameOf(partner);
  const ownBubbleStyle = me.accent_color ? { backgroundColor: me.accent_color } : undefined;

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

  const appendServerMessages = useCallback((incoming: MessageRow[]) => {
    if (incoming.length === 0) return;
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
  }, []);

  const mergeFlights = useCallback((rows: FlightRow[]) => {
    if (rows.length === 0) return;
    setFlights((prev) => {
      const next = { ...prev };
      for (const row of rows) next[row.message_id] = row;
      return next;
    });
  }, []);

  // One query for every flight in this chat — including letters flying to
  // me whose message row I can't read yet.
  const fetchFlights = useCallback(async () => {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("pigeon_flights")
      .select(FLIGHT_COLUMNS)
      .eq("chat_id", chatId);
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
  useEffect(() => {
    const known = new Set(messagesRef.current.map((m) => m.id));
    const landed = Object.values(flights)
      .filter(
        (f) =>
          f.status === "delivered" &&
          f.sender_id !== currentUserId &&
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
  }, [currentUserId, flights]);

  // ONE realtime channel for the whole chat: new messages (RLS only
  // delivers what I may read — so no in-flight letters to me) and every
  // flight change in this chat.
  useEffect(() => {
    const supabase = createClient();
    let channel: ReturnType<typeof supabase.channel> | undefined;
    let cancelled = false;
    let hasSubscribedOnce = false;

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
            if (hasSubscribedOnce) void resync();
            hasSubscribedOnce = true;
          }
        });
    });

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") void resync();
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("online", resync);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("online", resync);
      if (channel) supabase.removeChannel(channel);
    };
  }, [appendServerMessages, chatId, mergeFlights, resync]);

  // Both buckets are private, so image_url/audio_url only ever hold a
  // storage path ("{chatId}/{messageId}.ext"). Resolve them to signed URLs
  // in one batched request per bucket and cache by path. Failures are
  // surfaced via attachmentLoadErrors (with a manual retry in the UI)
  // instead of failing silently.
  const fetchSignedUrls = useCallback(async (refs: StorageRef[]) => {
    const uniqueRefs = Array.from(new Map(refs.map((r) => [r.path, r])).values());
    const toFetch = uniqueRefs.filter(
      (r) => !requestedSignedUrlPaths.current.has(r.path)
    );
    if (toFetch.length === 0) return;
    toFetch.forEach((r) => requestedSignedUrlPaths.current.add(r.path));

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
  }, []);

  // A signed URL that stops working (expired after SIGNED_URL_TTL_SECONDS
  // in a long-open tab) — drop it and fetch a fresh one.
  const refreshSignedUrl = useCallback(
    (ref: StorageRef) => {
      setSignedUrls((prev) => {
        if (!prev[ref.path]) return prev;
        const next = { ...prev };
        delete next[ref.path];
        return next;
      });
      requestedSignedUrlPaths.current.delete(ref.path);
      void fetchSignedUrls([ref]);
    },
    [fetchSignedUrls]
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
    }
    if (refs.length > 0) fetchSignedUrls(refs);
  }, [messages, fetchSignedUrls]);

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

  useEffect(() => {
    if (isAtBottomRef.current) scrollToBottom();
  }, [timeline, scrollToBottom]);

  function handleScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    isAtBottomRef.current = distanceFromBottom < BOTTOM_THRESHOLD_PX;
  }

  function handleMediaLoaded() {
    // An image finishing to load grows its bubble; stay pinned if we were.
    if (isAtBottomRef.current) scrollToBottom();
  }

  function setImageAttachment(file: File) {
    if (!file.type.startsWith("image/")) return;
    setAttachment({ kind: "image", file, previewUrl: createObjectUrl(file) });
  }

  function handleFileInputChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) setImageAttachment(file);
    event.target.value = "";
  }

  function handlePaste(event: ClipboardEvent<HTMLElement>) {
    const item = Array.from(event.clipboardData.items).find((i) =>
      i.type.startsWith("image/")
    );
    if (!item) return;
    const file = item.getAsFile();
    if (!file) return;
    event.preventDefault();
    setImageAttachment(file);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragOver(false);
    const file = Array.from(event.dataTransfer.files).find((f) =>
      f.type.startsWith("image/")
    );
    if (file) setImageAttachment(file);
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
    setMicError(null);
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
    kind: MessageKind
  ): Promise<boolean> {
    const supabase = createClient();
    let imagePath: string | null = null;
    let audioPath: string | null = null;
    let audioDuration: number | null = null;

    updateMessage(id, {
      uploadError: undefined,
      uploadProgress: attachmentToSend ? 0 : undefined,
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

        if (attachmentToSend.kind === "image") {
          const compressed = await compressChatImage(attachmentToSend.file);
          const path = buildChatImagePath(chatId, id, compressed);
          await uploadToBucket({
            supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
            apiKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
            accessToken,
            bucket: CHAT_IMAGE_BUCKET,
            path,
            file: compressed,
            contentType: compressed.type || "image/jpeg",
            onProgress: (fraction) => updateUploadProgress(id, fraction),
          });
          imagePath = path;
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
      uploadProgress: undefined,
      uploadError: undefined,
      pendingAttachment: undefined,
    });
    return true;
  }

  function submitMessage() {
    const text = draft.trim();
    const attachmentToSend = attachment;
    if ((!text && !attachmentToSend) || sending) return;
    const kind = mode;

    // First thing, while still inside the submit gesture (iOS only allows
    // audio started directly from one). Chat: the terminal "boot" chime
    // under the hacker show; letter: the take-off whoosh.
    if (kind === "chat") playEncryptStart();
    else playEncryptEnd();

    setDraft("");
    setAttachment(null);

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
      created_at: new Date().toISOString(),
      pending: true,
      ...(attachmentToSend
        ? {
            uploadProgress: 0,
            pendingAttachment: attachmentToSend,
            ...(attachmentToSend.kind === "image"
              ? { localImagePreview: attachmentToSend.previewUrl }
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
      // (the recipient has it immediately); the sender watches the hacker
      // show meanwhile, which can be tapped away.
      setSending(true);
      setShowEncryption(true);
      void performSend(id, text || null, attachmentToSend, "chat");
      return;
    }

    // Pigeon letter: no hacker show — straight to the flight map once the
    // letter is actually handed over. The map shows its own "getting
    // ready" state until the flight row arrives a beat later. Back to
    // chat mode afterwards: letters are the deliberate exception.
    setMode("chat");
    void performSend(id, text || null, attachmentToSend, "pigeon").then((ok) => {
      if (ok) setOpenFlightMessageId(id);
    });
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    submitMessage();
  }

  function handleLetterKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter makes a new line in a letter; Ctrl/Cmd+Enter sends it.
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      submitMessage();
    }
  }

  function handleEncryptionComplete() {
    setShowEncryption(false);
    setSending(false);
  }

  function retrySend(message: DisplayMessage) {
    void performSend(message.id, message.content, message.pendingAttachment ?? null, message.kind).then(
      (ok) => {
        if (ok && message.kind === "pigeon") setOpenFlightMessageId(message.id);
      }
    );
  }

  const closeFlightMap = useCallback(() => setOpenFlightMessageId(null), []);
  const closeLightbox = useCallback(() => setLightboxSrc(null), []);

  const hasSendableContent = !!draft.trim() || !!attachment;
  const isLetterMode = mode === "pigeon";
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
        ? `text-white ${ownBubbleStyle ? "" : "bg-neutral-900 dark:bg-night-bubble"}`
        : "bg-neutral-100 text-neutral-900 dark:bg-night-raised dark:text-night-text";

    return (
      <div className={`flex ${isOwn ? "justify-end" : "justify-start"}`}>
        <div
          style={!isLetter && isOwn ? ownBubbleStyle : undefined}
          className={`max-w-[80%] space-y-1 break-words rounded-2xl px-3 py-2 text-sm sm:max-w-[75%] ${bubbleClass} ${
            message.pending && !hasError ? "opacity-60" : ""
          }`}
        >
          {isLetter && (
            <p className="font-serif text-xs italic opacity-70">
              ✉️ {isOwn ? `Brief an ${partnerName}` : `Brief von ${partnerName}`}
            </p>
          )}
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
                      className="h-full bg-white transition-all"
                      style={{ width: `${message.uploadProgress}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
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
          {message.pending && !hasError && !isUploading && (
            <span className="text-xs opacity-70">
              {isLetter ? "Brief wird übergeben…" : "Wird gesendet…"}
            </span>
          )}
          {isLetter && !message.pending && !hasError && (
            <PigeonStatusBadge
              flight={flights[message.id]}
              loading={flightsLoading}
              onOpen={() => setOpenFlightMessageId(message.id)}
            />
          )}
        </div>
      </div>
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
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain px-4 py-4"
      >
        {timeline.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-sm text-neutral-400 dark:text-night-muted">
            <span className="text-3xl">🕊️</span>
            <p>Noch keine Nachrichten. Schreib {partnerName} — oder schick gleich eine Taube!</p>
          </div>
        )}
        {timeline.map((item) => (
          <div key={item.key}>
            {item.type === "message" ? renderMessage(item.message) : renderIncoming(item.flight)}
          </div>
        ))}
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
        {micError && (
          <div className="mb-2 flex items-start justify-between gap-2 rounded-xl border border-red-200 bg-red-50 p-2 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
            <span>{micError}</span>
            <button
              type="button"
              onClick={() => setMicError(null)}
              aria-label="Hinweis schließen"
              className="flex-shrink-0 text-red-400 hover:text-red-600"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}
        {attachment && (
          <div className="mb-2 flex items-center gap-2 rounded-xl border border-neutral-200 bg-neutral-50 p-2 dark:border-night-border dark:bg-night-surface">
            {attachment.kind === "image" ? (
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
        <form onSubmit={handleSubmit} className={`flex gap-2 ${isLetterMode ? "items-end" : "items-center"}`}>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleFileInputChange}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            aria-label="Bild anhängen"
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
            onClick={() => setMode(isLetterMode ? "chat" : "pigeon")}
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
              zoom the whole page in when the field gets focus. */}
          {isLetterMode ? (
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onPaste={handlePaste}
              onKeyDown={handleLetterKeyDown}
              rows={3}
              autoFocus
              placeholder={`Liebe/r ${partnerName}, …`}
              className="min-w-0 flex-1 resize-none rounded-xl border border-[#d8c9a3] px-3 py-2 font-serif text-base sm:text-sm dark:border-night-border"
            />
          ) : (
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onPaste={handlePaste}
              placeholder="Nachricht schreiben..."
              className="min-w-0 flex-1 rounded-full border border-neutral-300 px-4 py-2 text-base sm:text-sm dark:border-night-border"
            />
          )}
          {hasSendableContent ? (
            <button
              type="submit"
              disabled={sending}
              style={!isLetterMode ? ownBubbleStyle : undefined}
              className={`flex-shrink-0 rounded-full px-4 py-2 text-sm text-white disabled:opacity-50 ${
                isLetterMode
                  ? "bg-[#c1643a]"
                  : ownBubbleStyle
                    ? ""
                    : "bg-neutral-900 dark:bg-night-accent dark:text-night-bg"
              }`}
            >
              {isLetterMode ? "Losfliegen" : "Senden"}
            </button>
          ) : (
            <VoiceRecorderButton
              disabled={sending}
              onRecorded={handleVoiceRecorded}
              onError={setMicError}
            />
          )}
        </form>
      </div>
      {lightboxSrc && <ImageLightbox src={lightboxSrc} onClose={closeLightbox} />}
      <EncryptionSequence active={showEncryption} onComplete={handleEncryptionComplete} />
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
