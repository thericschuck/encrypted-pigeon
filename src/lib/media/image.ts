// Client-side image processing for chat pictures and avatars: decode
// whatever the user picked (JPEG, PNG, WebP, AVIF, GIF, BMP, HEIC from an
// iPhone, …), scale it down on a canvas and re-encode it — so a 48 MP
// photo becomes a few hundred KB before it ever leaves the device.
//
// Replaces browser-image-compression: its web worker had to load the
// library from a URL (CDN, later /vendor/), which hung or failed on some
// networks, and it rejected every file whose MIME type it didn't know.

export interface ProcessedImage {
  blob: Blob;
  contentType: string;
  extension: string;
}

interface ImageProcessingOptions {
  /** Longest side of the result, in px. */
  maxDimension: number;
  /** Encoder quality, 0-1. */
  quality?: number;
  /** Center-crop to a square (avatars). */
  square?: boolean;
}

const HEIC_EXTENSIONS = ["heic", "heif"];
const IMAGE_EXTENSIONS = [
  "jpg", "jpeg", "jfif", "png", "gif", "webp", "avif", "bmp", "tif", "tiff", "ico", "svg",
  ...HEIC_EXTENSIONS,
];

// Animated GIFs would freeze on a canvas; small ones go through untouched.
const MAX_PASSTHROUGH_GIF_BYTES = 8 * 1024 * 1024;

export function fileExtension(file: File): string {
  return file.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") ?? "";
}

/** By MIME type, or by extension when the browser didn't give a type (common for HEIC). */
export function looksLikeImage(file: File): boolean {
  return file.type.startsWith("image/") || (!file.type && IMAGE_EXTENSIONS.includes(fileExtension(file)));
}

function isHeic(file: File): boolean {
  return /image\/hei[cf]/.test(file.type) || HEIC_EXTENSIONS.includes(fileExtension(file));
}

type Drawable = ImageBitmap | HTMLImageElement;

function sizeOf(source: Drawable) {
  return source instanceof HTMLImageElement
    ? { width: source.naturalWidth, height: source.naturalHeight }
    : { width: source.width, height: source.height };
}

function loadViaImageElement(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.decoding = "async";
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("decode failed"));
    };
    img.src = url;
  });
}

async function decode(blob: Blob): Promise<Drawable> {
  // createImageBitmap applies the EXIF orientation and decodes off the
  // main thread; <img> is the fallback for formats/browsers where it
  // throws (e.g. SVG, or HEIC in Safari).
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(blob, { imageOrientation: "from-image" });
    } catch {
      // fall through
    }
  }
  return loadViaImageElement(blob);
}

async function decodeAnyImage(file: File): Promise<Drawable> {
  try {
    return await decode(file);
  } catch (error) {
    if (!isHeic(file)) throw error;
    // Chrome/Firefox can't decode HEIC; convert it in JS (lazy-loaded,
    // the decoder is large and rarely needed).
    const { default: heic2any } = await import("heic2any");
    const converted = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.92 });
    return decode(Array.isArray(converted) ? converted[0] : converted);
  }
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

export async function processImage(
  file: File,
  { maxDimension, quality = 0.85, square = false }: ImageProcessingOptions
): Promise<ProcessedImage> {
  if (!square && file.type === "image/gif" && file.size <= MAX_PASSTHROUGH_GIF_BYTES) {
    return { blob: file, contentType: "image/gif", extension: "gif" };
  }

  const source = await decodeAnyImage(file);
  const { width, height } = sizeOf(source);
  if (!width || !height) throw new Error("empty image");

  // Source rectangle: full image, or its centered square for avatars.
  const side = Math.min(width, height);
  const sx = square ? (width - side) / 2 : 0;
  const sy = square ? (height - side) / 2 : 0;
  const sw = square ? side : width;
  const sh = square ? side : height;

  const scale = Math.min(1, maxDimension / Math.max(sw, sh));
  const targetWidth = Math.max(1, Math.round(sw * scale));
  const targetHeight = Math.max(1, Math.round(sh * scale));

  const canvas = document.createElement("canvas");
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no canvas");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  // JPEG has no transparency — a white background instead of black.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, targetWidth, targetHeight);
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, targetWidth, targetHeight);
  if ("close" in source) source.close();

  // WebP where the browser can encode it (smaller), JPEG otherwise —
  // toBlob silently falls back to PNG for unsupported types, hence the check.
  const webp = await canvasToBlob(canvas, "image/webp", quality);
  if (webp && webp.type === "image/webp") {
    return { blob: webp, contentType: "image/webp", extension: "webp" };
  }
  const jpeg = await canvasToBlob(canvas, "image/jpeg", quality);
  if (!jpeg) throw new Error("encode failed");
  return { blob: jpeg, contentType: "image/jpeg", extension: "jpg" };
}
