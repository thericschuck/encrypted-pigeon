// Shared low-level upload used by both image and voice message attachments
// (see image-upload.ts / voice-recording.ts).

export class ChatUploadError extends Error {}

interface UploadToBucketOptions {
  supabaseUrl: string;
  apiKey: string;
  accessToken: string;
  bucket: string;
  path: string;
  file: Blob;
  contentType: string;
  onProgress?: (fraction: number) => void;
}

// Uploaded via a raw XHR POST (not supabase-js's fetch-based upload()) so we
// get real upload progress events for the in-bubble progress bar — the SDK
// doesn't expose those. x-upsert lets a retry safely re-send under the same
// object path.
export function uploadToBucket({
  supabaseUrl,
  apiKey,
  accessToken,
  bucket,
  path,
  file,
  contentType,
  onProgress,
}: UploadToBucketOptions): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const url = `${supabaseUrl}/storage/v1/object/${bucket}/${path}`;
    xhr.open("POST", url);
    xhr.setRequestHeader("Authorization", `Bearer ${accessToken}`);
    xhr.setRequestHeader("apikey", apiKey);
    xhr.setRequestHeader("Content-Type", contentType || "application/octet-stream");
    xhr.setRequestHeader("x-upsert", "true");

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress?.(event.loaded / event.total);
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(
          new ChatUploadError(
            `Upload fehlgeschlagen (${xhr.status}). Bitte erneut versuchen.`
          )
        );
      }
    };

    xhr.onerror = () => {
      reject(
        new ChatUploadError(
          "Netzwerkfehler beim Upload. Bitte Verbindung prüfen und erneut versuchen."
        )
      );
    };

    xhr.send(file);
  });
}
