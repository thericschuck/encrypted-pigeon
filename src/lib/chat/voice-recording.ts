// MediaRecorder mime-type selection for voice messages.
//
// No UA-sniffing here on purpose: iOS Safari simply doesn't support the
// webm/opus candidates (MediaRecorder.isTypeSupported returns false for
// them), so plain feature detection already prefers mp4/AAC there and
// webm/opus everywhere else, which is exactly the fallback behaviour we
// want — without the fragility of a user-agent check.
import type { TFunction } from "@/lib/i18n/translate";

const AUDIO_MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/mp4;codecs=mp4a.40.2",
  "audio/mp4",
  "audio/aac",
];

export { CHAT_VOICE_BUCKET } from "./buckets";

// Hard cap per voice note. At the bitrates below that is ~5 MB (opus) to
// ~7 MB (AAC), safely under the bucket's 15 MB file_size_limit — so anything
// the recorder produces is guaranteed to be accepted by storage.
export const MAX_VOICE_SECONDS = 10 * 60;
// Show a countdown during the last stretch before the cap auto-sends.
export const VOICE_WARNING_SECONDS = 30;

// Speech-tuned: mono, browser DSP on (echo cancel / noise suppression / auto
// gain) and 48 kHz — the native rate of opus, so no resampling.
export const VOICE_AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  channelCount: { ideal: 1 },
  sampleRate: { ideal: 48000 },
  echoCancellation: { ideal: true },
  noiseSuppression: { ideal: true },
  autoGainControl: { ideal: true },
};

// Chrome's default opus bitrate is ~128 kbps — wasteful for mono speech.
// 64 kbps opus is transparent for voice; AAC needs a bit more for the same
// quality.
export function voiceBitrateFor(mimeType: string | undefined): number {
  return mimeType?.startsWith("audio/mp4") || mimeType?.startsWith("audio/aac")
    ? 96_000
    : 64_000;
}

export function isVoiceRecordingSupported(): boolean {
  return (
    typeof MediaRecorder !== "undefined" &&
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia
  );
}

// Returns the full mime string (with codecs, e.g. "audio/webm;codecs=opus")
// for MediaRecorder to request the best available codec.
export function pickAudioRecordingMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return AUDIO_MIME_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type));
}

// The base mime type (no codec parameter) is what we store on the Blob and
// send as Content-Type — it's what the storage bucket's allowed_mime_types
// allowlist and <audio> playback both expect.
export function baseMimeType(mimeType: string): string {
  return mimeType.split(";")[0];
}

export function extensionForMimeType(mimeType: string): string {
  const base = baseMimeType(mimeType);
  if (base === "audio/mp4") return "m4a";
  if (base === "audio/aac") return "aac";
  if (base === "audio/ogg") return "ogg";
  return "webm";
}

export function buildChatVoicePath(
  chatId: string,
  messageId: string,
  mimeType: string
) {
  return `${chatId}/${messageId}.${extensionForMimeType(mimeType)}`;
}

function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  return (
    /iP(hone|ad|od)/.test(navigator.userAgent) ||
    // iPadOS reports itself as "MacIntel" but, unlike a real Mac, has touch.
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

// Only used for the human-readable hint after a permission denial — never
// for gating actual recording behaviour, so a wrong guess here just shows a
// slightly less specific tip rather than breaking anything.
export function microphonePermissionHint(t: TFunction): string {
  return isIOS() ? t("chatMisc.voiceRecorder.hintIos") : t("chatMisc.voiceRecorder.hintDesktop");
}
