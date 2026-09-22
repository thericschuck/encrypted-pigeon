import imageCompression from "browser-image-compression";
import { ChatUploadError } from "./storage-upload";

// Must match the bucket created in
// supabase/migrations/20260922000000_chat_images_storage.sql.
export const CHAT_IMAGE_BUCKET = "pigeon-chat-images";

const MAX_WIDTH_OR_HEIGHT = 1920;
const MAX_SIZE_MB = 4;

export async function compressChatImage(file: File): Promise<File> {
  try {
    return await imageCompression(file, {
      maxWidthOrHeight: MAX_WIDTH_OR_HEIGHT,
      maxSizeMB: MAX_SIZE_MB,
      useWebWorker: true,
    });
  } catch (error) {
    throw new ChatUploadError(
      error instanceof Error
        ? `Bild konnte nicht verarbeitet werden: ${error.message}`
        : "Bild konnte nicht verarbeitet werden."
    );
  }
}

export function buildChatImagePath(
  chatId: string,
  messageId: string,
  file: File
) {
  const extension =
    file.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") ||
    "jpg";
  return `${chatId}/${messageId}.${extension}`;
}
