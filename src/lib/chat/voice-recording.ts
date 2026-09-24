// MediaRecorder mime-type selection for voice messages.
//
// No UA-sniffing here on purpose: iOS Safari simply doesn't support the
// webm/opus candidates (MediaRecorder.isTypeSupported returns false for
// them), so plain feature detection already prefers mp4/AAC there and
// webm/opus everywhere else, which is exactly the fallback behaviour we
// want — without the fragility of a user-agent check.
const AUDIO_MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/mp4;codecs=mp4a.40.2",
  "audio/mp4",
  "audio/aac",
];

export { CHAT_VOICE_BUCKET } from "./buckets";

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
export function microphonePermissionHint(): string {
  if (isIOS()) {
    return 'So erlaubst du es nachträglich: Einstellungen-App → Safari → Mikrofon. Oder: Tippe in Safari auf "aA" in der Adressleiste → Website-Einstellungen → Mikrofon auf "Erlauben" stellen.';
  }
  return "So erlaubst du es nachträglich: Klicke auf das Schloss-/Info-Symbol links neben der Adresse in der Adressleiste und erlaube den Mikrofonzugriff für diese Seite.";
}
