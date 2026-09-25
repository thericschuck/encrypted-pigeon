"use client";

// The outbox: every message I'm sending, for as long as this tab lives —
// not tied to <ChatRoom />. Leaving a chat mid-upload used to drop the
// bubble, its progress and its retry button with the component (the
// request itself kept running, invisibly). Now the send runs here, the
// chat just renders what's in the outbox, and coming back shows the
// bubble right where it is. Closing/reloading the tab mid-send asks
// first (beforeunload).
//
// Object URLs of attachments handed to the outbox are owned by it (and
// revoked when the entry goes), so they stay valid after the chat that
// created them unmounts.

import { useMemo, useSyncExternalStore } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Database, MessageKind } from "@/lib/supabase/types";
import { ChatUploadError, uploadToBucket } from "@/lib/chat/storage-upload";
import { CHAT_IMAGE_BUCKET, buildChatAttachmentPath, compressChatImage } from "@/lib/chat/image-upload";
import { CHAT_VIDEO_BUCKET } from "@/lib/chat/buckets";
import { CHAT_VOICE_BUCKET, baseMimeType, buildChatVoicePath } from "@/lib/chat/voice-recording";
import { VideoTooLargeError, processVideo } from "@/lib/media/video";
import { previewOf } from "@/lib/chat/chat-overview";
import { noteChatActivity } from "@/lib/chat/chat-list-store";
import { isSessionExpiredError, redirectToLoginForExpiredSession } from "@/lib/auth/session-expiry";

type MessageRow = Database["pigeon"]["Tables"]["messages"]["Row"];

export type PendingAttachment =
  | { kind: "image"; file: File; previewUrl: string }
  | { kind: "video"; file: File; previewUrl: string }
  | { kind: "voice"; blob: Blob; previewUrl: string; durationSeconds: number; mimeType: string };

export type DisplayMessage = MessageRow & {
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

export type OutboxMessage = DisplayMessage & {
  /** The row as the server stored it, once the send went through. */
  serverRow?: MessageRow;
};

// A sent entry lingers this long so its local preview can bridge the gap
// until the chat has the signed URL of the real upload.
const SENT_RETENTION_MS = 2 * 60 * 1000;

let entries: OutboxMessage[] = [];
const listeners = new Set<() => void>();
// Sends currently running, so a double-tapped retry doesn't start a second.
const running = new Set<string>();

function emit() {
  syncUnloadGuard();
  listeners.forEach((listener) => listener());
}

function update(id: string, patch: Partial<OutboxMessage>) {
  entries = entries.map((m) => (m.id === id ? { ...m, ...patch } : m));
  emit();
}

function remove(id: string) {
  const entry = entries.find((m) => m.id === id);
  if (!entry) return;
  for (const url of [entry.localImagePreview, entry.localAudioPreview, entry.localVideoPreview]) {
    if (url) URL.revokeObjectURL(url);
  }
  entries = entries.filter((m) => m.id !== id);
  emit();
}

// ---------------------------------------------------------------------------
// "Wirklich verlassen?" while something is still on its way
// ---------------------------------------------------------------------------
function handleBeforeUnload(event: BeforeUnloadEvent) {
  event.preventDefault();
  // Legacy browsers only show the prompt with returnValue set.
  event.returnValue = "";
}

let unloadGuardActive = false;
function syncUnloadGuard() {
  if (typeof window === "undefined") return;
  const active = entries.some((m) => m.pending && !m.uploadError);
  if (active === unloadGuardActive) return;
  unloadGuardActive = active;
  if (active) window.addEventListener("beforeunload", handleBeforeUnload);
  else window.removeEventListener("beforeunload", handleBeforeUnload);
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------
function sendErrorMessage(): string {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return "Keine Internetverbindung. Nachricht wurde nicht gesendet.";
  }
  return "Nachricht konnte nicht gesendet werden.";
}

function uploadErrorMessage(error: unknown): string {
  if (typeof navigator !== "undefined" && !navigator.onLine) return "Keine Internetverbindung. Upload fehlgeschlagen.";
  if (error instanceof ChatUploadError) return error.message;
  if (error instanceof VideoTooLargeError) {
    return error.message === "unsupported"
      ? "Dieser Browser kann das Video nicht verkleinern. Bitte Browser aktualisieren oder anderes Gerät nutzen."
      : "Video ist zu lang (über ca. 1,5 Std.), um es klein genug zu rechnen.";
  }
  return "Upload fehlgeschlagen. Bitte erneut versuchen.";
}

function progressUpdater(id: string) {
  return (fraction: number) => update(id, { uploadProgress: Math.round(fraction * 100) });
}

// Shared by the first send and by "Erneut versuchen", so both go through
// the exact same upload + insert logic. Resolves true once the message
// row exists on the server.
async function performSend(id: string): Promise<boolean> {
  const message = entries.find((m) => m.id === id);
  if (!message || running.has(id)) return false;
  running.add(id);
  try {
    const { chat_id: chatId, pendingAttachment: attachment } = message;
    const supabase = createClient();
    let imagePath: string | null = null;
    let audioPath: string | null = null;
    let videoPath: string | null = null;
    let audioDuration: number | null = null;

    update(id, {
      uploadError: undefined,
      uploadProgress: attachment ? 0 : undefined,
      uploadPhase: attachment && attachment.kind !== "voice" ? "processing" : "uploading",
    });

    if (attachment) {
      try {
        // getSession() also refreshes an expired access token; if that
        // fails there's no session left to upload with.
        const { data: sessionData } = await supabase.auth.getSession();
        const accessToken = sessionData.session?.access_token;
        if (!accessToken) {
          redirectToLoginForExpiredSession();
          return false;
        }

        if (attachment.kind === "image" || attachment.kind === "video") {
          const isVideo = attachment.kind === "video";
          const processed = isVideo
            ? await processVideo(attachment.file, progressUpdater(id))
            : await compressChatImage(attachment.file);
          update(id, { uploadPhase: "uploading", uploadProgress: 0 });
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
            onProgress: progressUpdater(id),
          });
          if (isVideo) videoPath = path;
          else imagePath = path;
        } else {
          const path = buildChatVoicePath(chatId, id, attachment.mimeType);
          await uploadToBucket({
            supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
            apiKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
            accessToken,
            bucket: CHAT_VOICE_BUCKET,
            path,
            file: attachment.blob,
            contentType: baseMimeType(attachment.mimeType),
            onProgress: progressUpdater(id),
          });
          audioPath = path;
          audioDuration = Math.round(attachment.durationSeconds);
        }
      } catch (error) {
        if (error instanceof ChatUploadError && error.status === 401) {
          redirectToLoginForExpiredSession();
          return false;
        }
        update(id, { uploadError: uploadErrorMessage(error), uploadProgress: undefined });
        return false;
      }
    }

    // For a pigeon letter this insert is also what launches the flight
    // (server-side trigger -> start-pigeon-flight). The returned row
    // carries the server's created_at — the chat's catch-up cursor must
    // never be set from this device's clock.
    const { data: inserted, error } = await supabase
      .from("messages")
      .insert({
        id,
        chat_id: chatId,
        sender_id: message.sender_id,
        kind: message.kind,
        content: message.content,
        image_url: imagePath,
        audio_url: audioPath,
        audio_duration_seconds: audioDuration,
        video_url: videoPath,
        reply_to_id: message.reply_to_id,
      })
      .select("*")
      .single();

    let serverRow = inserted ?? undefined;
    if (error) {
      // 23505 = this id already exists: an earlier attempt did reach the
      // server, only its response got lost. That's a success, not a failure.
      if (error.code !== "23505") {
        if (isSessionExpiredError(error)) {
          redirectToLoginForExpiredSession();
          return false;
        }
        console.error("Failed to send message:", error.message);
        update(id, { uploadError: sendErrorMessage(), uploadProgress: undefined });
        return false;
      }
      const { data: existing } = await supabase.from("messages").select("*").eq("id", id).maybeSingle();
      serverRow = existing ?? undefined;
    }

    // Local preview stays around as a fallback source until the signed URL
    // for the real upload resolves, so the bubble never flashes a broken
    // image/player right after a successful send.
    update(id, {
      pending: false,
      image_url: imagePath,
      audio_url: audioPath,
      audio_duration_seconds: audioDuration,
      video_url: videoPath,
      uploadProgress: undefined,
      uploadError: undefined,
      pendingAttachment: undefined,
      serverRow,
    });
    // Keeps the chat list current even when no chat is open right now.
    if (serverRow) {
      noteChatActivity(chatId, {
        preview: previewOf(serverRow),
        kind: serverRow.kind,
        createdAt: serverRow.created_at,
        fromMe: true,
      });
    }
    setTimeout(() => remove(id), SENT_RETENTION_MS);
    return true;
  } finally {
    running.delete(id);
  }
}

export interface NewOutgoingMessage {
  id: string;
  chatId: string;
  senderId: string;
  kind: MessageKind;
  text: string | null;
  replyToId: string | null;
  /** Its previewUrl now belongs to the outbox (revoked when the entry goes). */
  attachment: PendingAttachment | null;
}

/** Queues a message and sends it. Resolves true once it's on the server. */
export function sendMessage(input: NewOutgoingMessage): Promise<boolean> {
  const { attachment } = input;
  const entry: OutboxMessage = {
    id: input.id,
    chat_id: input.chatId,
    sender_id: input.senderId,
    kind: input.kind,
    content: input.text,
    image_url: null,
    audio_url: null,
    audio_duration_seconds: null,
    video_url: null,
    reply_to_id: input.replyToId,
    created_at: new Date().toISOString(),
    pending: true,
    ...(attachment
      ? {
          uploadProgress: 0,
          pendingAttachment: attachment,
          ...(attachment.kind === "image"
            ? { localImagePreview: attachment.previewUrl }
            : attachment.kind === "video"
              ? { localVideoPreview: attachment.previewUrl }
              : { localAudioPreview: attachment.previewUrl, audio_duration_seconds: attachment.durationSeconds }),
        }
      : {}),
  };
  entries = [...entries, entry];
  emit();
  return performSend(entry.id);
}

/** "Erneut versuchen" on a failed message. */
export function retryMessage(id: string): Promise<boolean> {
  return performSend(id);
}

/** "Verwerfen": drop a failed message that won't be retried. */
export function discardMessage(id: string) {
  const entry = entries.find((m) => m.id === id);
  if (entry?.uploadError && !running.has(id)) remove(id);
}

// ---------------------------------------------------------------------------
// React
// ---------------------------------------------------------------------------
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Same array every call: useSyncExternalStore re-renders on identity.
const NO_ENTRIES: OutboxMessage[] = [];
const getSnapshot = () => entries;
const getServerSnapshot = () => NO_ENTRIES;

/** This chat's outbox entries, oldest first. */
export function useOutbox(chatId: string): OutboxMessage[] {
  const all = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return useMemo(() => all.filter((m) => m.chat_id === chatId), [all, chatId]);
}
