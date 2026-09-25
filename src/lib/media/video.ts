// Client-side video processing for chat videos: re-encode to H.264/AAC
// MP4 at a resolution and bitrate that keep the file under the bucket
// limit — so a clip of any size or length (a 4K iPhone HEVC .mov of
// several GB, an hour-long recording) arrives as an MP4 below 50 MB that
// plays in every browser. Uses WebCodecs via mediabunny, which uses the
// device's hardware encoder and reads the input lazily (the original is
// never loaded into memory as a whole). Lazy-loaded: only needed once a
// video is sent.

import { fileExtension } from "./image";

export interface ProcessedVideo {
  blob: Blob;
  contentType: string;
  extension: string;
}

/** Must stay below the pigeon-chat-videos bucket limit (50 MB). */
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
// Budget for the first attempt, with headroom for container overhead and
// encoders that overshoot their target bitrate. If the result still ends
// up too big, the next attempt aims lower by exactly the overshoot.
const TARGET_BYTES = 42 * 1024 * 1024;
const MAX_ATTEMPTS = 3;
// Small clips are sent untouched — but only if every browser can show
// them: H.264 in MP4 or VP8/VP9 in WebM. An HEVC clip (iPhone default)
// in an .mp4 plays as a black box with sound in many browsers.
const PASSTHROUGH_MAX_BYTES = 8 * 1024 * 1024;
const PASSTHROUGH_CODECS: Record<string, string[]> = {
  "video/mp4": ["avc"],
  "video/webm": ["vp8", "vp9"],
};

const MAX_VIDEO_BITRATE = 2_500_000;
// Below this even a tiny picture turns to mush; longer videos get fewer
// frames per second instead (see settingsFor).
const MIN_VIDEO_BITRATE = 40_000;

const VIDEO_EXTENSIONS = ["mp4", "m4v", "mov", "webm", "mkv", "avi", "3gp", "ogv", "wmv", "mpg", "mpeg", "ts"];

export function looksLikeVideo(file: File): boolean {
  return file.type.startsWith("video/") || (!file.type && VIDEO_EXTENSIONS.includes(fileExtension(file)));
}

export class VideoTooLargeError extends Error {}

/** Resolution, frame rate and audio quality that suit a given bit budget. */
function settingsFor(totalBitrate: number) {
  const audioBitrate = totalBitrate >= 600_000 ? 96_000 : totalBitrate >= 150_000 ? 48_000 : 24_000;
  // Whole bits per second: Quality({ bitrate }) rejects fractions.
  const videoBitrate = Math.round(
    Math.max(MIN_VIDEO_BITRATE, Math.min(MAX_VIDEO_BITRATE, totalBitrate - audioBitrate))
  );
  const longSide =
    videoBitrate >= 1_500_000 ? 1280
    : videoBitrate >= 700_000 ? 960
    : videoBitrate >= 350_000 ? 640
    : videoBitrate >= 150_000 ? 480
    : 360;
  const frameRate = videoBitrate >= 300_000 ? undefined : videoBitrate >= 120_000 ? 24 : 15;
  return { audioBitrate, videoBitrate, longSide, frameRate };
}

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

async function transcode(
  file: File,
  targetBytes: number,
  onProgress?: (fraction: number) => void
): Promise<ProcessedVideo> {
  const { ALL_FORMATS, BlobSource, BufferTarget, Conversion, Input, Mp4OutputFormat, Output, Quality } =
    await import("mediabunny");

  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const duration = Math.max(1, await input.computeDuration());
    const videoTrack = await input.getPrimaryVideoTrack();
    if (!videoTrack) throw new Error("no video track");
    const width = await videoTrack.getDisplayWidth();
    const height = await videoTrack.getDisplayHeight();

    const { audioBitrate, videoBitrate, longSide, frameRate } = settingsFor((targetBytes * 8) / duration);
    const scale = Math.min(1, longSide / Math.max(width, height));

    const run = async (
      audioCodec: "aac" | "opus",
      hardwareAcceleration: "no-preference" | "prefer-software" = "no-preference"
    ) => {
      const output = new Output({ format: new Mp4OutputFormat({ fastStart: "in-memory" }), target: new BufferTarget() });
      const conversion = await Conversion.init({
        input,
        output,
        tracks: "primary",
        video: {
          width: even(width * scale),
          height: even(height * scale),
          fit: "contain",
          codec: "avc",
          // { bitrate } — a bare number would be a quality *level* (0-1),
          // and 2,500,000 on that scale made encoders reject the track.
          quality: new Quality({ bitrate: videoBitrate }),
          ...(frameRate ? { frameRate } : {}),
          forceTranscode: true,
          hardwareAcceleration,
        },
        audio: { codec: audioCodec, quality: new Quality({ bitrate: audioBitrate }), numberOfChannels: 2 },
        showWarnings: false,
      });
      return { output, conversion };
    };

    let audioCodec: "aac" | "opus" = "aac";
    let { output, conversion } = await run(audioCodec);
    // Some browsers can't encode AAC — Opus in MP4 still plays everywhere
    // current, which beats silently dropping the sound.
    if (conversion.discardedTracks.some((d) => d.track.isAudioTrack() && d.reason === "no_encodable_target_codec")) {
      audioCodec = "opus";
      ({ output, conversion } = await run(audioCodec));
    }
    // Some hardware H.264 encoders refuse a size/bitrate combination the
    // software encoder handles fine.
    const lostVideo = () => conversion.discardedTracks.some((d) => d.track.isVideoTrack());
    if (lostVideo()) ({ output, conversion } = await run(audioCodec, "prefer-software"));
    // Never ship a "video" without a picture: that's exactly the black,
    // sound-only clip this used to produce. Fall back instead (processVideo).
    if (!conversion.isValid || lostVideo()) throw new Error("cannot convert video track");

    conversion.onProgress = (progress) => onProgress?.(progress);
    await conversion.execute();

    const buffer = output.target.buffer;
    if (!buffer) throw new Error("no output");
    return { blob: new Blob([buffer], { type: "video/mp4" }), contentType: "video/mp4", extension: "mp4" };
  } finally {
    input.dispose();
  }
}

/** Small MP4/WebM whose picture every browser can decode — no need to re-encode. */
async function isBrowserFriendly(file: File): Promise<boolean> {
  const allowed = PASSTHROUGH_CODECS[file.type];
  if (!allowed) return false;
  try {
    const { ALL_FORMATS, BlobSource, Input } = await import("mediabunny");
    const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
    try {
      const codec = await (await input.getPrimaryVideoTrack())?.getCodec();
      return !!codec && allowed.includes(codec);
    } finally {
      input.dispose();
    }
  } catch {
    return false;
  }
}

function asIs(file: File): ProcessedVideo {
  const extension = fileExtension(file) || "mp4";
  return { blob: file, contentType: file.type || `video/${extension === "mov" ? "quicktime" : extension}`, extension };
}

// A long conversion on a phone must not be cut short by the screen
// locking itself (which suspends the page). Best effort.
async function keepScreenOn(): Promise<() => void> {
  try {
    const lock = await navigator.wakeLock?.request("screen");
    return () => void lock?.release().catch(() => {});
  } catch {
    return () => {};
  }
}

export async function processVideo(file: File, onProgress?: (fraction: number) => void): Promise<ProcessedVideo> {
  if (file.size <= PASSTHROUGH_MAX_BYTES && (await isBrowserFriendly(file))) return asIs(file);

  const releaseScreen = await keepScreenOn();
  try {
    let targetBytes = TARGET_BYTES;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const result = await transcode(file, targetBytes, onProgress);
      // Re-encoding can't beat an already small file — keep the smaller one.
      if (result.blob.size >= file.size && file.size <= MAX_VIDEO_BYTES) return asIs(file);
      if (result.blob.size <= MAX_VIDEO_BYTES) return result;
      // Encoder overshot: aim lower by the overshoot, plus some margin.
      targetBytes = Math.floor(targetBytes * (TARGET_BYTES / result.blob.size) * 0.9);
      onProgress?.(0);
    }
    throw new VideoTooLargeError();
  } catch (error) {
    // No WebCodecs (older browsers) or a codec the device can't decode or
    // encode: the original is the best we have if it fits — it plays at
    // least wherever the recipient's browser knows its codec.
    if (file.size <= MAX_VIDEO_BYTES) return asIs(file);
    if (error instanceof VideoTooLargeError) throw error;
    console.error("Video conversion failed:", error);
    throw new VideoTooLargeError("unsupported");
  } finally {
    releaseScreen();
  }
}
