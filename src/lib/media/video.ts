// Client-side video processing for chat videos: re-encode to H.264/AAC
// MP4 at a resolution and bitrate that keep the file under the bucket
// limit — so a 4K iPhone clip (HEVC .mov, hundreds of MB) arrives as a
// small MP4 that plays in every browser. Uses WebCodecs via mediabunny,
// which uses the device's hardware encoder, so it runs faster than
// real time on most phones. Lazy-loaded: only needed once a video is sent.

import { fileExtension } from "./image";

export interface ProcessedVideo {
  blob: Blob;
  contentType: string;
  extension: string;
}

/** Must stay below the pigeon-chat-videos bucket limit (50 MB). */
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
// Budget for the re-encoded file, with headroom for container overhead
// and encoders that overshoot their target bitrate.
const TARGET_BYTES = 40 * 1024 * 1024;
// Small, already browser-friendly clips are sent untouched.
const PASSTHROUGH_MAX_BYTES = 8 * 1024 * 1024;
const PASSTHROUGH_TYPES = ["video/mp4", "video/webm"];

const MAX_VIDEO_BITRATE = 2_500_000;
const MIN_VIDEO_BITRATE = 80_000;

const VIDEO_EXTENSIONS = ["mp4", "m4v", "mov", "webm", "mkv", "avi", "3gp", "ogv", "wmv", "mpg", "mpeg", "ts"];

export function looksLikeVideo(file: File): boolean {
  return file.type.startsWith("video/") || (!file.type && VIDEO_EXTENSIONS.includes(fileExtension(file)));
}

export class VideoTooLargeError extends Error {}

function longSideFor(videoBitrate: number): number {
  if (videoBitrate >= 1_500_000) return 1280;
  if (videoBitrate >= 700_000) return 960;
  if (videoBitrate >= 350_000) return 640;
  return 480;
}

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

async function transcode(file: File, onProgress?: (fraction: number) => void): Promise<ProcessedVideo> {
  const { ALL_FORMATS, BlobSource, BufferTarget, Conversion, Input, Mp4OutputFormat, Output, Quality } =
    await import("mediabunny");

  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const duration = Math.max(1, await input.computeDuration());
    const videoTrack = await input.getPrimaryVideoTrack();
    if (!videoTrack) throw new Error("no video track");
    const width = await videoTrack.getDisplayWidth();
    const height = await videoTrack.getDisplayHeight();

    // Long videos trade quality for fitting at all (~1 h still goes through).
    const audioBitrate = duration > 20 * 60 ? 48_000 : 96_000;
    const videoBitrate = Math.max(
      MIN_VIDEO_BITRATE,
      Math.min(MAX_VIDEO_BITRATE, (TARGET_BYTES * 8) / duration - audioBitrate)
    );
    const scale = Math.min(1, longSideFor(videoBitrate) / Math.max(width, height));

    const run = async (audioCodec: "aac" | "opus") => {
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
          quality: new Quality(videoBitrate),
          forceTranscode: true,
        },
        audio: { codec: audioCodec, quality: new Quality(audioBitrate), numberOfChannels: 2 },
        showWarnings: false,
      });
      return { output, conversion };
    };

    let { output, conversion } = await run("aac");
    // Some browsers can't encode AAC — Opus in MP4 still plays everywhere
    // current, which beats silently dropping the sound.
    if (conversion.discardedTracks.some((d) => d.track.isAudioTrack() && d.reason === "no_encodable_target_codec")) {
      ({ output, conversion } = await run("opus"));
    }
    if (!conversion.isValid) throw new Error("cannot convert");

    conversion.onProgress = (progress) => onProgress?.(progress);
    await conversion.execute();

    const buffer = output.target.buffer;
    if (!buffer) throw new Error("no output");
    return { blob: new Blob([buffer], { type: "video/mp4" }), contentType: "video/mp4", extension: "mp4" };
  } finally {
    input.dispose();
  }
}

function asIs(file: File): ProcessedVideo {
  const extension = fileExtension(file) || "mp4";
  return { blob: file, contentType: file.type || `video/${extension === "mov" ? "quicktime" : extension}`, extension };
}

export async function processVideo(file: File, onProgress?: (fraction: number) => void): Promise<ProcessedVideo> {
  if (file.size <= PASSTHROUGH_MAX_BYTES && PASSTHROUGH_TYPES.includes(file.type)) return asIs(file);

  try {
    const result = await transcode(file, onProgress);
    // Re-encoding can't beat an already tiny file — keep the smaller one.
    if (result.blob.size >= file.size && file.size <= MAX_VIDEO_BYTES) return asIs(file);
    if (result.blob.size > MAX_VIDEO_BYTES) throw new VideoTooLargeError();
    return result;
  } catch (error) {
    // No WebCodecs (older browsers) or a codec the device can't decode:
    // the original still works if it fits.
    if (file.size <= MAX_VIDEO_BYTES) return asIs(file);
    if (error instanceof VideoTooLargeError) throw error;
    console.error("Video conversion failed:", error);
    throw new VideoTooLargeError();
  }
}
