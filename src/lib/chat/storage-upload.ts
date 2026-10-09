// Shared low-level upload used by both image and voice message attachments
// (see image-upload.ts / voice-recording.ts).

export class ChatUploadError extends Error {
  /** HTTP status of the failed upload, if it got a response at all. */
  status?: number;
  /** Message key (chatMisc.*) + params; the outbox translates them for display. */
  params?: Record<string, string | number>;

  constructor(messageKey: string, status?: number, params?: Record<string, string | number>) {
    super(messageKey);
    this.status = status;
    this.params = params;
  }
}

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
    // One object path per message and never changed afterwards, so the
    // browser may keep it (served under a reused signed URL, see
    // signed-url-cache.ts) instead of downloading it again.
    xhr.setRequestHeader("cache-control", "max-age=31536000");

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress?.(event.loaded / event.total);
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(new ChatUploadError("chatMisc.upload.failedStatus", xhr.status, { status: xhr.status }));
      }
    };

    xhr.onerror = () => {
      reject(new ChatUploadError("chatMisc.upload.network"));
    };

    xhr.send(file);
  });
}
