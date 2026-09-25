"use client";

import { useEffect, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";

// "#t=0.001" makes Safari (iOS especially) decode and show the first frame
// as the thumbnail — with plain preload="metadata" it stays a black box
// until played. Other browsers ignore it or behave the same.
function withFirstFrame(src: string) {
  return src.includes("#") ? src : `${src}#t=0.001`;
}

function formatDuration(seconds: number) {
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

/**
 * Video in a chat bubble, like WhatsApp: first frame + play button +
 * duration; tapping opens <VideoLightbox />. No inline controls — they
 * don't fit a 240px bubble and hide the picture.
 */
export function ChatVideo({
  src,
  interactive,
  onOpen,
  onLoaded,
  onError,
}: {
  src: string;
  interactive: boolean;
  onOpen: () => void;
  onLoaded: () => void;
  onError: () => void;
}) {
  const [meta, setMeta] = useState<{ duration: number; hasPicture: boolean } | null>(null);

  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={!interactive}
      aria-label="Video abspielen"
      className="relative block w-full disabled:cursor-default"
    >
      {!meta && <Skeleton className="absolute inset-0 rounded-xl" />}
      <video
        src={withFirstFrame(src)}
        muted
        playsInline
        preload="metadata"
        onLoadedMetadata={(event) => {
          const video = event.currentTarget;
          setMeta({
            duration: Number.isFinite(video.duration) ? video.duration : 0,
            // 0x0 = the file has no picture at all (sound only).
            hasPicture: video.videoWidth > 0,
          });
          onLoaded();
        }}
        onError={onError}
        className={`pointer-events-none max-h-72 w-full object-cover ${meta ? "" : "min-h-40 opacity-0"} ${
          meta && !meta.hasPicture ? "hidden" : ""
        }`}
      />
      {meta && !meta.hasPicture && (
        <div className="flex h-40 flex-col items-center justify-center gap-1 text-xs text-white/70">
          <span className="text-2xl">🎬</span>
          Video ohne Bild (nur Ton)
        </div>
      )}
      {interactive && meta && (
        <span className="absolute inset-0 flex items-center justify-center">
          <span className="rounded-full bg-black/55 p-3 text-white shadow-lg">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-6 w-6 translate-x-px">
              <path d="M8 5.14v13.72a1 1 0 0 0 1.52.85l10.6-6.86a1 1 0 0 0 0-1.7L9.52 4.29A1 1 0 0 0 8 5.14Z" />
            </svg>
          </span>
        </span>
      )}
      {meta && meta.duration > 0 && (
        <span className="absolute bottom-1.5 left-1.5 rounded-md bg-black/60 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-white">
          {formatDuration(meta.duration)}
        </span>
      )}
    </button>
  );
}

/** Full-screen player; autoplays (the tap that opened it counts as the gesture). */
export function VideoLightbox({ src, onClose }: { src: string; onClose: () => void }) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(3.5rem,env(safe-area-inset-top))]"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Video"
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Schließen"
        className="absolute right-4 top-[max(1rem,env(safe-area-inset-top))] rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
        </svg>
      </button>
      <video
        src={src}
        controls
        autoPlay
        playsInline
        onClick={(event) => event.stopPropagation()}
        className="max-h-full max-w-full rounded-lg bg-black shadow-2xl"
      />
    </div>
  );
}
