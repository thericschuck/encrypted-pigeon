import { ChatUploadError } from "./storage-upload";
import { fileExtension, processImage, type ProcessedImage } from "@/lib/media/image";

export { CHAT_IMAGE_BUCKET } from "./buckets";

const MAX_DIMENSION = 2048;
/** Must match the pigeon-chat-images bucket limit. */
const MAX_IMAGE_BYTES = 50 * 1024 * 1024;

const EXTENSION_TYPES: Record<string, string> = {
  heic: "image/heic",
  heif: "image/heif",
  avif: "image/avif",
  tif: "image/tiff",
  tiff: "image/tiff",
  bmp: "image/bmp",
  jxl: "image/jxl",
};

export async function compressChatImage(file: File): Promise<ProcessedImage> {
  try {
    return await processImage(file, { maxDimension: MAX_DIMENSION, quality: 0.85 });
  } catch (error) {
    // A format this browser can't decode at all: send the original
    // rather than refuse it — the recipient's browser may well show it.
    console.warn("Image could not be processed, sending original:", error);
    if (file.size > MAX_IMAGE_BYTES) {
      throw new ChatUploadError("Bild ist zu groß und konnte nicht verkleinert werden.");
    }
    const extension = fileExtension(file) || "jpg";
    return {
      blob: file,
      contentType: file.type || EXTENSION_TYPES[extension] || "application/octet-stream",
      extension,
    };
  }
}

export function buildChatAttachmentPath(chatId: string, messageId: string, extension: string) {
  return `${chatId}/${messageId}.${extension.replace(/[^a-z0-9]/g, "") || "bin"}`;
}
