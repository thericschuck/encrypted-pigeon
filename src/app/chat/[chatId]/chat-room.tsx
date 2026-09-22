"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent,
  type FormEvent,
} from "react";
import { createClient } from "@/lib/supabase/client";
import type { Database } from "@/lib/supabase/types";
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
import { ImageLightbox } from "@/components/chat/image-lightbox";
import { VoiceMessagePlayer } from "@/components/chat/voice-message-player";
import { VoiceRecorderButton, type RecordedVoice } from "@/components/chat/voice-recorder-button";

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

interface ChatRoomProps {
  chatId: string;
  currentUserId: string;
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

export function ChatRoom({
  chatId,
  currentUserId,
  initialMessages,
}: ChatRoomProps) {
  const [messages, setMessages] = useState<DisplayMessage[]>(initialMessages);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [attachment, setAttachment] = useState<PendingAttachment | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});
  const [imageLoadErrors, setImageLoadErrors] = useState<Record<string, string>>({});
  const [micError, setMicError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const requestedSignedUrlPaths = useRef<Set<string>>(new Set());

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  // Start pinned to the bottom on first render.
  useEffect(() => {
    scrollToBottom();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (isAtBottomRef.current) scrollToBottom();
  }, [messages, scrollToBottom]);

  useEffect(() => {
    const supabase = createClient();
    let channel: ReturnType<typeof supabase.channel> | undefined;
    let cancelled = false;

    // createClient()'s session is restored from cookies asynchronously; if
    // the channel subscribes before that finishes, "postgres_changes"
    // authorizes as anon and RLS silently drops every event. Awaiting
    // getSession() first is a cheap way to wait for that hydration.
    supabase.auth.getSession().then(() => {
      if (cancelled) return;
      channel = supabase
        .channel(`chat-${chatId}-messages`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "pigeon",
            table: "messages",
            filter: `chat_id=eq.${chatId}`,
          },
          (payload) => {
            const incoming = payload.new as MessageRow;
            setMessages((prev) =>
              prev.some((m) => m.id === incoming.id) ? prev : [...prev, incoming]
            );
          }
        )
        .subscribe();
    });

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, [chatId]);

  // Both buckets are private, so image_url/audio_url only ever hold a
  // storage path ("{chatId}/{messageId}.ext"). Resolve each one to a signed
  // URL lazily and cache it by path. Failures are surfaced via
  // imageLoadErrors (with a manual retry in the UI) instead of failing
  // silently — a signed-url request fired right after mount, before
  // createClient()'s session is restored from cookies, otherwise goes out
  // unauthenticated, RLS denies it, and the attachment never re-tries on
  // its own.
  const fetchSignedUrls = useCallback(async (refs: StorageRef[]) => {
    const uniqueRefs = Array.from(new Map(refs.map((r) => [r.path, r])).values());
    const toFetch = uniqueRefs.filter(
      (r) => !requestedSignedUrlPaths.current.has(r.path)
    );
    if (toFetch.length === 0) return;
    toFetch.forEach((r) => requestedSignedUrlPaths.current.add(r.path));

    const supabase = createClient();
    await supabase.auth.getSession();

    const results = await Promise.all(
      toFetch.map(async (ref) => {
        const { data, error } = await supabase.storage
          .from(ref.bucket)
          .createSignedUrl(ref.path, SIGNED_URL_TTL_SECONDS);
        return { path: ref.path, url: data?.signedUrl, error: error?.message };
      })
    );

    setSignedUrls((prev) => {
      const next = { ...prev };
      for (const r of results) if (r.url) next[r.path] = r.url;
      return next;
    });
    setImageLoadErrors((prev) => {
      const next = { ...prev };
      for (const r of results) {
        if (r.url) delete next[r.path];
        else next[r.path] = r.error ?? "Anhang konnte nicht geladen werden.";
      }
      return next;
    });
    // Allow a failed path to be picked up again, either by a manual retry
    // or the next time the messages array changes.
    results.forEach((r) => {
      if (!r.url) requestedSignedUrlPaths.current.delete(r.path);
    });
  }, []);

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

  function handleScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    isAtBottomRef.current = distanceFromBottom < BOTTOM_THRESHOLD_PX;
  }

  function setImageAttachment(file: File) {
    if (!file.type.startsWith("image/")) return;
    setAttachment((prev) => {
      if (prev) URL.revokeObjectURL(prev.previewUrl);
      return { kind: "image", file, previewUrl: URL.createObjectURL(file) };
    });
  }

  function handleFileInputChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) setImageAttachment(file);
    event.target.value = "";
  }

  function handlePaste(event: ClipboardEvent<HTMLInputElement>) {
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
    setAttachment((prev) => {
      if (prev) URL.revokeObjectURL(prev.previewUrl);
      return null;
    });
  }

  function handleVoiceRecorded(result: RecordedVoice) {
    setMicError(null);
    setAttachment((prev) => {
      if (prev) URL.revokeObjectURL(prev.previewUrl);
      return {
        kind: "voice",
        blob: result.blob,
        previewUrl: URL.createObjectURL(result.blob),
        durationSeconds: result.durationSeconds,
        mimeType: result.mimeType,
      };
    });
  }

  function updateUploadProgress(id: string, fraction: number) {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === id ? { ...m, uploadProgress: Math.round(fraction * 100) } : m
      )
    );
  }

  // Shared by the initial send and by "Erneut versuchen" (retry), so both
  // paths go through the exact same upload + insert logic and leave the
  // message bubble in a consistent state.
  async function performSend(
    id: string,
    text: string | null,
    attachmentToSend: PendingAttachment | null
  ) {
    const supabase = createClient();
    let imagePath: string | null = null;
    let audioPath: string | null = null;
    let audioDuration: number | null = null;

    if (attachmentToSend) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === id ? { ...m, uploadError: undefined, uploadProgress: 0 } : m
        )
      );

      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const accessToken = sessionData.session?.access_token;
        if (!accessToken) throw new ChatUploadError("Nicht angemeldet.");

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
        const message =
          error instanceof ChatUploadError
            ? error.message
            : "Upload fehlgeschlagen. Bitte erneut versuchen.";
        setMessages((prev) =>
          prev.map((m) =>
            m.id === id
              ? { ...m, uploadError: message, uploadProgress: undefined }
              : m
          )
        );
        return;
      }
    }

    const { error } = await supabase.from("messages").insert({
      id,
      chat_id: chatId,
      sender_id: currentUserId,
      content: text,
      image_url: imagePath,
      audio_url: audioPath,
      audio_duration_seconds: audioDuration,
    });

    if (error) {
      console.error("Failed to send message:", error.message);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === id
            ? {
                ...m,
                uploadError: "Nachricht konnte nicht gesendet werden.",
                uploadProgress: undefined,
              }
            : m
        )
      );
      return;
    }

    // Local preview stays around (and isn't revoked) as a fallback source
    // until the signed URL for the real upload resolves, so the bubble
    // never flashes a broken image/player right after a successful send.
    setMessages((prev) =>
      prev.map((m) =>
        m.id === id
          ? {
              ...m,
              pending: false,
              image_url: imagePath,
              audio_url: audioPath,
              audio_duration_seconds: audioDuration,
              uploadProgress: undefined,
              uploadError: undefined,
            }
          : m
      )
    );

    // Every message — text, image or voice — goes through the same
    // encryption/pigeon-flight sequence.
    const { error: flightError } = await supabase
      .from("pigeon_flights")
      .insert({ message_id: id, status: "encrypting" });

    if (flightError) {
      console.error("Failed to create pigeon flight:", flightError.message);
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    const attachmentToSend = attachment;
    if ((!text && !attachmentToSend) || sending) return;

    setDraft("");
    setAttachment(null);
    setSending(true);

    const id = crypto.randomUUID();
    const optimisticMessage: DisplayMessage = {
      id,
      chat_id: chatId,
      sender_id: currentUserId,
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

    await performSend(id, text || null, attachmentToSend);
    setSending(false);
  }

  function retrySend(message: DisplayMessage) {
    if (!message.pendingAttachment) return;
    performSend(message.id, message.content, message.pendingAttachment);
  }

  const hasSendableContent = !!draft.trim() || !!attachment;

  return (
    <div className="flex h-full flex-col">
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 py-4"
      >
        {messages.map((message) => {
          const isOwn = message.sender_id === currentUserId;
          const imageSrc =
            (message.image_url && signedUrls[message.image_url]) ||
            message.localImagePreview;
          const audioSrc =
            (message.audio_url && signedUrls[message.audio_url]) ||
            message.localAudioPreview;
          const isUploading = message.uploadProgress !== undefined;
          const hasError = !!message.uploadError;
          const imageLoadError = message.image_url
            ? imageLoadErrors[message.image_url]
            : undefined;
          const audioLoadError = message.audio_url
            ? imageLoadErrors[message.audio_url]
            : undefined;

          return (
            <div
              key={message.id}
              className={`flex ${isOwn ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[75%] space-y-1 rounded-2xl px-3 py-2 text-sm ${
                  isOwn
                    ? "bg-neutral-900 text-white"
                    : "bg-neutral-100 text-neutral-900"
                } ${message.pending && !hasError ? "opacity-60" : ""}`}
              >
                {imageSrc && (
                  <div className="relative overflow-hidden rounded-xl">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={imageSrc}
                      alt="Bild"
                      onClick={() => {
                        if (!isUploading && !hasError) setLightboxSrc(imageSrc);
                      }}
                      className={`max-h-64 w-full rounded-xl object-cover ${
                        !isUploading && !hasError ? "cursor-zoom-in" : ""
                      }`}
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
                  <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-neutral-300 p-4 text-center">
                    <span className="text-xs text-neutral-500">
                      {imageLoadError ?? "Bild wird geladen…"}
                    </span>
                    {imageLoadError && (
                      <button
                        type="button"
                        onClick={() =>
                          fetchSignedUrls([{ bucket: CHAT_IMAGE_BUCKET, path: message.image_url! }])
                        }
                        className="text-xs font-medium underline"
                      >
                        Erneut versuchen
                      </button>
                    )}
                  </div>
                )}
                {audioSrc && (
                  <div>
                    <VoiceMessagePlayer
                      src={audioSrc}
                      durationSeconds={message.audio_duration_seconds}
                      variant={isOwn ? "own" : "other"}
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
                  <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-neutral-300 p-4 text-center">
                    <span className="text-xs text-neutral-500">
                      {audioLoadError ?? "Sprachnachricht wird geladen…"}
                    </span>
                    {audioLoadError && (
                      <button
                        type="button"
                        onClick={() =>
                          fetchSignedUrls([{ bucket: CHAT_VOICE_BUCKET, path: message.audio_url! }])
                        }
                        className="text-xs font-medium underline"
                      >
                        Erneut versuchen
                      </button>
                    )}
                  </div>
                )}
                {message.content && (
                  <p className="whitespace-pre-wrap">{message.content}</p>
                )}
                {hasError && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs opacity-80">{message.uploadError}</span>
                    <button
                      type="button"
                      onClick={() => retrySend(message)}
                      className="text-xs font-medium underline"
                    >
                      Erneut versuchen
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div
        className={`border-t border-neutral-200 p-3 transition-colors ${
          isDragOver ? "bg-neutral-50" : ""
        }`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {micError && (
          <div className="mb-2 flex items-start justify-between gap-2 rounded-xl border border-red-200 bg-red-50 p-2 text-xs text-red-700">
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
          <div className="mb-2 flex items-center gap-2 rounded-xl border border-neutral-200 bg-neutral-50 p-2">
            {attachment.kind === "image" ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={attachment.previewUrl}
                  alt="Ausgewähltes Bild"
                  className="h-12 w-12 rounded-lg object-cover"
                />
                <span className="flex-1 truncate text-xs text-neutral-500">
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
              className="flex-shrink-0 rounded-full p-1 text-neutral-500 hover:bg-neutral-200"
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
        <form onSubmit={handleSubmit} className="flex items-center gap-2">
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
            className="flex-shrink-0 rounded-full p-2 text-neutral-500 hover:bg-neutral-100"
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
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onPaste={handlePaste}
            placeholder="Nachricht schreiben..."
            className="flex-1 rounded-full border border-neutral-300 px-4 py-2 text-sm"
          />
          {hasSendableContent ? (
            <button
              type="submit"
              disabled={sending}
              className="flex-shrink-0 rounded-full bg-neutral-900 px-4 py-2 text-sm text-white disabled:opacity-50"
            >
              Senden
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
      {lightboxSrc && (
        <ImageLightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />
      )}
    </div>
  );
}
