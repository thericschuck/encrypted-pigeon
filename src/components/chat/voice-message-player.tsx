"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";

interface VoiceMessagePlayerProps {
  src: string;
  durationSeconds?: number | null;
  // "own" = white-on-dark bubble, "other" = dark-on-light bubble/composer.
  variant?: "own" | "other";
  /** Fired when the source fails to load (e.g. an expired signed URL). */
  onError?: () => void;
}

function formatDuration(seconds: number) {
  const total = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  const secs = total % 60;
  return `${minutes}:${secs.toString().padStart(2, "0")}`;
}

export function VoiceMessagePlayer({
  src,
  durationSeconds,
  variant = "other",
  onError,
}: VoiceMessagePlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(durationSeconds ?? 0);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    function handleTimeUpdate() {
      setCurrentTime(audio!.currentTime);
    }
    function handleLoadedMetadata() {
      if (Number.isFinite(audio!.duration)) setDuration(audio!.duration);
    }
    function handleEnded() {
      setIsPlaying(false);
      setCurrentTime(0);
    }

    audio.addEventListener("timeupdate", handleTimeUpdate);
    audio.addEventListener("loadedmetadata", handleLoadedMetadata);
    audio.addEventListener("ended", handleEnded);
    return () => {
      audio.removeEventListener("timeupdate", handleTimeUpdate);
      audio.removeEventListener("loadedmetadata", handleLoadedMetadata);
      audio.removeEventListener("ended", handleEnded);
    };
  }, [src]);

  function togglePlay() {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
    } else {
      audio.play().catch(() => setIsPlaying(false));
      setIsPlaying(true);
    }
  }

  function handleSeek(event: ChangeEvent<HTMLInputElement>) {
    const audio = audioRef.current;
    if (!audio) return;
    const value = Number(event.target.value);
    audio.currentTime = value;
    setCurrentTime(value);
  }

  const isOwn = variant === "own";
  // "other" accent follows the color scheme (dark text on light bubble,
  // light text on dark bubble); CSS var so it can switch without JS.
  const accent = isOwn ? "#ffffff" : "var(--foreground)";

  return (
    <div className="flex w-full min-w-[180px] items-center gap-2">
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        className="hidden"
        onError={() => {
          setIsPlaying(false);
          onError?.();
        }}
      />
      <button
        type="button"
        onClick={togglePlay}
        aria-label={isPlaying ? "Pause" : "Abspielen"}
        className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full ${
          isOwn
            ? "bg-white/15 text-white"
            : "bg-neutral-200 text-neutral-900 dark:bg-night-border dark:text-night-text"
        }`}
      >
        {isPlaying ? (
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
            <rect x="6" y="5" width="4" height="14" rx="1" />
            <rect x="14" y="5" width="4" height="14" rx="1" />
          </svg>
        ) : (
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
            <path d="M8 5v14l11-7z" />
          </svg>
        )}
      </button>
      <input
        type="range"
        min={0}
        max={duration || 0}
        step={0.1}
        value={Math.min(currentTime, duration || 0)}
        onChange={handleSeek}
        style={{ accentColor: accent }}
        className="h-1.5 flex-1"
        aria-label="Wiedergabeposition"
      />
      <span className="w-9 flex-shrink-0 text-right text-xs tabular-nums opacity-80">
        {formatDuration(isPlaying || currentTime > 0 ? currentTime : duration)}
      </span>
    </div>
  );
}
