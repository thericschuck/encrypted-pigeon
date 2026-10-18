"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  MAX_VOICE_SECONDS,
  VOICE_AUDIO_CONSTRAINTS,
  VOICE_WARNING_SECONDS,
  baseMimeType,
  isVoiceRecordingSupported,
  microphonePermissionHint,
  pickAudioRecordingMimeType,
  voiceBitrateFor,
} from "@/lib/chat/voice-recording";
import { useT } from "@/lib/i18n/client";

export interface RecordedVoice {
  blob: Blob;
  durationSeconds: number;
  mimeType: string;
}

interface VoiceRecorderButtonProps {
  disabled?: boolean;
  onRecorded: (result: RecordedVoice) => void;
  onError: (message: string) => void;
}

// WhatsApp-style gesture: hold the mic to record, release to send, slide
// left to cancel, slide up to lock (hands-free) — then send/trash buttons.
const CANCEL_SWIPE_PX = 80;
const LOCK_SWIPE_PX = 70;
// Taps shorter than this are almost always accidental (e.g. a mis-click)
// rather than an intended, if very short, voice note.
const MIN_RECORDING_MS = 400;
const LEVEL_BAR_COUNT = 24;
const IDLE_LEVELS = () => Array<number>(LEVEL_BAR_COUNT).fill(0.1);

type Phase = "idle" | "starting" | "holding" | "locked";

export function VoiceRecorderButton({
  disabled,
  onRecorded,
  onError,
}: VoiceRecorderButtonProps) {
  const t = useT();
  const [phase, setPhaseState] = useState<Phase>("idle");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [drag, setDrag] = useState({ x: 0, y: 0 });
  const [levels, setLevels] = useState<number[]>(IDLE_LEVELS);

  // The gesture handlers and recorder callbacks outlive a single render, so
  // the authoritative state lives in refs (state is only for painting).
  const phaseRef = useRef<Phase>("idle");
  const pressedRef = useRef(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startTimeRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pointerStartRef = useRef({ x: 0, y: 0 });
  const dragRef = useRef({ x: 0, y: 0 });
  const cancelledRef = useRef(false);
  const mimeTypeRef = useRef("");
  const audioContextRef = useRef<AudioContext | null>(null);
  const levelRafRef = useRef<number | null>(null);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const onRecordedRef = useRef(onRecorded);
  const onErrorRef = useRef(onError);
  onRecordedRef.current = onRecorded;
  onErrorRef.current = onError;

  const setPhase = useCallback((next: Phase) => {
    phaseRef.current = next;
    setPhaseState(next);
  }, []);

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const stopLevelMeter = useCallback(() => {
    if (levelRafRef.current !== null) {
      cancelAnimationFrame(levelRafRef.current);
      levelRafRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
  }, []);

  const releaseStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const releaseWakeLock = useCallback(() => {
    wakeLockRef.current?.release().catch(() => {});
    wakeLockRef.current = null;
  }, []);

  const startLevelMeter = useCallback((stream: MediaStream) => {
    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      const audioContext = new AudioCtx();
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      audioContext.createMediaStreamSource(stream).connect(analyser);
      audioContextRef.current = audioContext;

      const data = new Uint8Array(analyser.frequencyBinCount);
      let lastPaint = 0;
      const tick = (now: number) => {
        // ~20 fps is plenty for a level meter and spares re-renders.
        if (now - lastPaint >= 50) {
          lastPaint = now;
          analyser.getByteTimeDomainData(data);
          let sumSquares = 0;
          for (let i = 0; i < data.length; i++) {
            const normalized = (data[i] - 128) / 128;
            sumSquares += normalized * normalized;
          }
          const level = Math.min(1, Math.sqrt(sumSquares / data.length) * 4);
          setLevels((prev) => [...prev.slice(1), Math.max(0.1, level)]);
        }
        levelRafRef.current = requestAnimationFrame(tick);
      };
      levelRafRef.current = requestAnimationFrame(tick);
    } catch {
      // Live level meter is a nice-to-have; recording still works without it.
    }
  }, []);

  const resetUi = useCallback(() => {
    setPhase("idle");
    setElapsedMs(0);
    setDrag({ x: 0, y: 0 });
    dragRef.current = { x: 0, y: 0 };
    setLevels(IDLE_LEVELS());
  }, [setPhase]);

  // Unmount mid-recording (navigating away, closing the chat): stop the
  // recorder and release the microphone. Without this the mic indicator
  // stayed on and the stream + AudioContext leaked until a full reload.
  useEffect(() => {
    return () => {
      cancelledRef.current = true;
      pressedRef.current = false;
      const recorder = mediaRecorderRef.current;
      if (recorder) {
        recorder.ondataavailable = null;
        recorder.onstop = null;
        if (recorder.state !== "inactive") recorder.stop();
      }
      if (timerRef.current) clearInterval(timerRef.current);
      stopLevelMeter();
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      wakeLockRef.current?.release().catch(() => {});
    };
  }, [stopLevelMeter]);

  const stopRecording = useCallback(
    (cancel: boolean) => {
      cancelledRef.current = cancel;
      const recorder = mediaRecorderRef.current;
      if (recorder && recorder.state !== "inactive") {
        recorder.stop(); // onstop does the rest
      } else {
        stopTimer();
        stopLevelMeter();
        releaseStream();
        releaseWakeLock();
        resetUi();
      }
    },
    [releaseStream, releaseWakeLock, resetUi, stopLevelMeter, stopTimer]
  );

  const startRecording = useCallback(
    async (clientX: number, clientY: number) => {
      if (disabled || phaseRef.current !== "idle") return;

      if (!isVoiceRecordingSupported()) {
        onErrorRef.current(t("chatMisc.voiceRecorder.unsupported"));
        return;
      }

      cancelledRef.current = false;
      pressedRef.current = true;
      pointerStartRef.current = { x: clientX, y: clientY };
      dragRef.current = { x: 0, y: 0 };
      setDrag({ x: 0, y: 0 });
      setPhase("starting");

      let stream: MediaStream;
      try {
        try {
          stream = await navigator.mediaDevices.getUserMedia({ audio: VOICE_AUDIO_CONSTRAINTS });
        } catch (error) {
          // Some devices reject the tuned constraints; plain audio always works.
          if (error instanceof DOMException && error.name === "OverconstrainedError") {
            stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          } else {
            throw error;
          }
        }
      } catch (error) {
        const name = error instanceof DOMException ? error.name : "";
        if (name === "NotAllowedError" || name === "PermissionDeniedError" || name === "SecurityError") {
          onErrorRef.current(t("chatMisc.voiceRecorder.denied", { hint: microphonePermissionHint(t) }));
        } else if (name === "NotFoundError" || name === "DevicesNotFoundError") {
          onErrorRef.current(t("chatMisc.voiceRecorder.noMic"));
        } else {
          onErrorRef.current(t("chatMisc.voiceRecorder.micFailed"));
        }
        resetUi();
        return;
      }

      // Released (or unmounted) while the mic/permission prompt was still
      // pending: without this check the recorder would start with nobody
      // holding the button and never stop.
      if (!pressedRef.current || (phaseRef.current as Phase) !== "starting") {
        stream.getTracks().forEach((track) => track.stop());
        resetUi();
        return;
      }

      const mimeType = pickAudioRecordingMimeType();
      mimeTypeRef.current = mimeType ?? "";
      streamRef.current = stream;
      chunksRef.current = [];

      let recorder: MediaRecorder;
      try {
        const bitrate = { audioBitsPerSecond: voiceBitrateFor(mimeType) };
        recorder = mimeType
          ? new MediaRecorder(stream, { mimeType, ...bitrate })
          : new MediaRecorder(stream, bitrate);
      } catch {
        try {
          recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
        } catch {
          releaseStream();
          resetUi();
          onErrorRef.current(t("chatMisc.voiceRecorder.recordFailed"));
          return;
        }
      }
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };

      recorder.onerror = () => {
        // Keep whatever was captured so far rather than losing the note.
        if (recorder.state !== "inactive") recorder.stop();
      };

      recorder.onstop = () => {
        stopTimer();
        stopLevelMeter();
        releaseStream();
        releaseWakeLock();
        const wasCancelled = cancelledRef.current;
        const durationSeconds = Math.min(
          (Date.now() - startTimeRef.current) / 1000,
          MAX_VOICE_SECONDS
        );
        const type = baseMimeType(mimeTypeRef.current || chunksRef.current[0]?.type || "audio/webm");
        const blob = new Blob(chunksRef.current, { type });
        chunksRef.current = [];
        mediaRecorderRef.current = null;
        resetUi();

        if (wasCancelled) return;
        if (durationSeconds * 1000 < MIN_RECORDING_MS || blob.size === 0) {
          onErrorRef.current(t("chatMisc.voiceRecorder.holdHint"));
          return;
        }
        onRecordedRef.current({ blob, durationSeconds, mimeType: type });
      };

      // The mic disappearing (incoming call, OS reclaiming it, headset
      // unplugged) ends the tracks: finish and keep what we have.
      stream.getAudioTracks().forEach((track) => {
        track.onended = () => {
          if (recorder.state !== "inactive") {
            cancelledRef.current = false;
            recorder.stop();
          }
        };
      });

      startTimeRef.current = Date.now();
      // A timeslice makes the browser hand over data every second instead of
      // buffering the whole note until stop(); long recordings no longer hinge
      // on one giant final chunk.
      recorder.start(1000);
      setPhase(pressedRef.current ? "holding" : "locked");
      startLevelMeter(stream);
      timerRef.current = setInterval(() => {
        const elapsed = Date.now() - startTimeRef.current;
        setElapsedMs(elapsed);
        if (elapsed >= MAX_VOICE_SECONDS * 1000) stopRecording(false);
      }, 100);

      // Best effort: keep the screen (and mic) alive during a hands-free note.
      navigator.wakeLock
        ?.request("screen")
        .then((lock) => {
          if (phaseRef.current === "idle") lock.release().catch(() => {});
          else wakeLockRef.current = lock;
        })
        .catch(() => {});

      // Finger already lifted while the recorder spun up: send what we have.
      if (!pressedRef.current) stopRecording(false);
    },
    [disabled, releaseStream, releaseWakeLock, resetUi, setPhase, startLevelMeter, stopLevelMeter, stopRecording, stopTimer, t]
  );

  function handlePointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Capture is only an optimisation for tracking the drag.
    }
    void startRecording(event.clientX, event.clientY);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
    if (phaseRef.current !== "holding") return;
    const dx = Math.max(0, pointerStartRef.current.x - event.clientX);
    const dy = Math.max(0, pointerStartRef.current.y - event.clientY);
    // Follow whichever axis the finger is clearly committing to.
    const next = dy > dx ? { x: 0, y: dy } : { x: dx, y: 0 };
    dragRef.current = next;
    setDrag(next);
    if (next.y > LOCK_SWIPE_PX) {
      // Hands-free: the recording goes on after the finger is lifted.
      setPhase("locked");
      setDrag({ x: 0, y: 0 });
      dragRef.current = { x: 0, y: 0 };
    }
  }

  function handlePointerUp() {
    pressedRef.current = false;
    if (phaseRef.current === "holding") {
      stopRecording(dragRef.current.x > CANCEL_SWIPE_PX);
    } else if (phaseRef.current === "starting") {
      // Released before the mic was ready: startRecording sees pressedRef
      // is false and drops the stream (quick tap / permission prompt).
    }
    // "locked": the gesture is over but the recording continues.
  }

  function handlePointerCancel() {
    // The OS can cancel the pointer (system gesture, notification shade).
    // Treat it like a release so the note is sent instead of silently lost.
    handlePointerUp();
  }

  const totalSeconds = Math.floor(elapsedMs / 1000);
  const timeLabel = `${Math.floor(totalSeconds / 60)}:${(totalSeconds % 60).toString().padStart(2, "0")}`;
  const remainingSeconds = MAX_VOICE_SECONDS - totalSeconds;
  const nearLimit = remainingSeconds <= VOICE_WARNING_SECONDS;
  const nearCancel = drag.x > CANCEL_SWIPE_PX / 2;
  const lockProgress = Math.min(1, drag.y / LOCK_SWIPE_PX);
  const active = phase === "holding" || phase === "locked";

  const meter = (
    <span className="flex h-5 items-center gap-[2px]" aria-hidden="true">
      {levels.map((level, index) => (
        <span
          key={index}
          className="w-[2px] rounded-full bg-red-400"
          style={{ height: `${3 + level * 15}px` }}
        />
      ))}
    </span>
  );

  const timeBlock = (
    <>
      <span className="h-2 w-2 flex-shrink-0 animate-pulse rounded-full bg-red-500" />
      <span className={`tabular-nums ${nearLimit ? "font-medium text-red-500" : ""}`}>{timeLabel}</span>
      {nearLimit && <span className="text-xs text-red-500">{t("chatMisc.voiceRecorder.secondsLeft", { seconds: Math.max(0, remainingSeconds) })}</span>}
    </>
  );

  // Hands-free mode: trash on the left, live meter, send on the right.
  if (phase === "locked") {
    return (
      <div className="relative flex items-center">
        <div className="absolute bottom-0 right-0 z-10 flex w-[min(22rem,calc(100vw-1.5rem))] items-center gap-2 rounded-full bg-neutral-100 py-1 pl-1 pr-1 text-sm text-neutral-700 shadow-sm dark:bg-night-raised dark:text-night-text">
          <button
            type="button"
            onClick={() => stopRecording(true)}
            aria-label={t("chatMisc.voiceRecorder.discard")}
            className="flex-shrink-0 rounded-full p-2 text-red-500 hover:bg-red-500/10"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-5 w-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.35 9m-4.78 0L9.26 9m9.97-3.21c.34.05.68.11 1.02.17m-1.02-.17L18.16 19.67a2.25 2.25 0 0 1-2.24 2.08H8.08a2.25 2.25 0 0 1-2.25-2.08L4.77 5.79m14.46 0a48.1 48.1 0 0 0-3.48-.4m-12 .56c.34-.06.68-.12 1.02-.17m0 0a48.11 48.11 0 0 1 3.48-.4m7.5 0v-.92c0-1.18-.91-2.16-2.09-2.2a51.96 51.96 0 0 0-3.32 0c-1.18.04-2.09 1.02-2.09 2.2v.92m7.5 0a48.67 48.67 0 0 0-7.5 0" />
            </svg>
          </button>
          <span className="flex min-w-0 flex-1 items-center gap-2">
            {timeBlock}
            <span className="min-w-0 overflow-hidden">{meter}</span>
          </span>
          <button
            type="button"
            onClick={() => stopRecording(false)}
            aria-label={t("chatMisc.voiceRecorder.send")}
            className="flex-shrink-0 rounded-full bg-accent p-2 text-on-accent"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 12 3.27 3.13a59.77 59.77 0 0 1 18.22 8.87 59.77 59.77 0 0 1-18.22 8.88L6 12Zm0 0h7.5" />
            </svg>
          </button>
        </div>
        {/* Keeps the row's layout stable while the overlay covers the composer. */}
        <span className="p-2"><span className="block h-5 w-5" /></span>
      </div>
    );
  }

  return (
    <div className="relative flex items-center">
      {phase === "holding" && (
        <>
          <div className="absolute right-full mr-2 flex items-center gap-2 whitespace-nowrap rounded-full bg-neutral-100 px-3 py-1.5 text-xs text-neutral-700 dark:bg-night-raised dark:text-night-text">
            {timeBlock}
            <span className="max-[380px]:hidden">{meter}</span>
            <span className={nearCancel ? "font-medium text-red-500" : "text-neutral-400 dark:text-night-muted"}>
              {nearCancel ? t("chatMisc.voiceRecorder.releaseToCancel") : t("chatMisc.voiceRecorder.swipeToCancel")}
            </span>
          </div>
          {/* Lock hint: slide the mic up into it, like WhatsApp. */}
          <div
            className="absolute bottom-full left-1/2 mb-3 flex -translate-x-1/2 flex-col items-center gap-1 rounded-full bg-neutral-100 px-2 py-2 text-neutral-500 shadow-sm dark:bg-night-raised dark:text-night-muted"
            style={{ opacity: 0.6 + lockProgress * 0.4 }}
            aria-hidden="true"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-4 w-4">
              <rect x="5" y="11" width="14" height="9" rx="2" />
              <path strokeLinecap="round" d="M8 11V8a4 4 0 0 1 8 0v3" />
            </svg>
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-3 w-3">
              <path strokeLinecap="round" strokeLinejoin="round" d="m6 15 6-6 6 6" />
            </svg>
          </div>
        </>
      )}
      <button
        type="button"
        disabled={disabled}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onContextMenu={(event) => event.preventDefault()}
        aria-label={t("chatMisc.voiceRecorder.record")}
        style={{
          // touch-action: none stops the browser from claiming the drag as a
          // scroll (which would fire pointercancel and drop the recording).
          touchAction: "none",
          WebkitTouchCallout: "none",
          userSelect: "none",
          transform:
            phase === "holding"
              ? `translate(${-Math.min(drag.x, CANCEL_SWIPE_PX)}px, ${-Math.min(drag.y, LOCK_SWIPE_PX)}px) scale(1.5)`
              : undefined,
        }}
        className={`flex-shrink-0 rounded-full p-3 shadow-sm transition-colors ${
          active ? "bg-red-500 text-white" : "bg-accent text-on-accent hover:opacity-90"
        } disabled:opacity-50`}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          className="h-6 w-6"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 0 1-14 0M12 18v3" />
        </svg>
      </button>
    </div>
  );
}
