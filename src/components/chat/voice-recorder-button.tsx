"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  baseMimeType,
  isVoiceRecordingSupported,
  microphonePermissionHint,
  pickAudioRecordingMimeType,
} from "@/lib/chat/voice-recording";

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

// Drag the button this many px to the left (mouse/touch) to cancel instead
// of sending, mirroring the swipe-to-cancel gesture from WhatsApp.
const CANCEL_SWIPE_PX = 80;
// Taps shorter than this are almost always accidental (e.g. a mis-click)
// rather than an intended, if very short, voice note.
const MIN_RECORDING_MS = 400;
const LEVEL_BAR_COUNT = 5;

export function VoiceRecorderButton({
  disabled,
  onRecorded,
  onError,
}: VoiceRecorderButtonProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [dragX, setDragX] = useState(0);
  const [levels, setLevels] = useState<number[]>(() => Array(LEVEL_BAR_COUNT).fill(0.15));

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startTimeRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pointerStartXRef = useRef(0);
  const cancelledRef = useRef(false);
  const mimeTypeRef = useRef("");
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const levelRafRef = useRef<number | null>(null);

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
    analyserRef.current = null;
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
  }, []);

  const cleanupStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const startLevelMeter = useCallback((stream: MediaStream) => {
    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      const audioContext = new AudioCtx();
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      const source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);
      audioContextRef.current = audioContext;
      analyserRef.current = analyser;

      const data = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        analyser.getByteTimeDomainData(data);
        let sumSquares = 0;
        for (let i = 0; i < data.length; i++) {
          const normalized = (data[i] - 128) / 128;
          sumSquares += normalized * normalized;
        }
        const rms = Math.sqrt(sumSquares / data.length);
        const level = Math.min(1, rms * 4);
        setLevels((prev) => [...prev.slice(1), Math.max(0.12, level)]);
        levelRafRef.current = requestAnimationFrame(tick);
      };
      levelRafRef.current = requestAnimationFrame(tick);
    } catch {
      // Live level meter is a nice-to-have; recording still works without it.
    }
  }, []);

  useEffect(() => stopLevelMeter, [stopLevelMeter]);

  const startRecording = useCallback(
    async (clientX: number) => {
      if (disabled || isRecording) return;

      if (!isVoiceRecordingSupported()) {
        onError("Sprachnachrichten werden von diesem Browser nicht unterstützt.");
        return;
      }

      cancelledRef.current = false;
      pointerStartXRef.current = clientX;
      setDragX(0);

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (error) {
        const name = error instanceof DOMException ? error.name : "";
        if (name === "NotAllowedError" || name === "PermissionDeniedError" || name === "SecurityError") {
          onError(`Mikrofonzugriff wurde verweigert. ${microphonePermissionHint()}`);
        } else if (name === "NotFoundError" || name === "DevicesNotFoundError") {
          onError("Es wurde kein Mikrofon gefunden.");
        } else {
          onError("Mikrofon konnte nicht gestartet werden. Bitte erneut versuchen.");
        }
        return;
      }

      const mimeType = pickAudioRecordingMimeType();
      mimeTypeRef.current = mimeType ?? "";
      streamRef.current = stream;
      chunksRef.current = [];

      let recorder: MediaRecorder;
      try {
        recorder = mimeType
          ? new MediaRecorder(stream, { mimeType })
          : new MediaRecorder(stream);
      } catch {
        cleanupStream();
        onError("Aufnahme konnte nicht gestartet werden. Bitte erneut versuchen.");
        return;
      }
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };

      recorder.onstop = () => {
        stopTimer();
        stopLevelMeter();
        cleanupStream();
        const wasCancelled = cancelledRef.current;
        const durationSeconds = (Date.now() - startTimeRef.current) / 1000;
        const type = baseMimeType(mimeTypeRef.current || chunksRef.current[0]?.type || "audio/webm");
        const blob = new Blob(chunksRef.current, { type });
        chunksRef.current = [];
        setIsRecording(false);
        setElapsedMs(0);
        setDragX(0);
        setLevels(Array(LEVEL_BAR_COUNT).fill(0.15));

        if (wasCancelled) return;
        if (durationSeconds * 1000 < MIN_RECORDING_MS || blob.size === 0) return;
        onRecorded({ blob, durationSeconds, mimeType: type });
      };

      startTimeRef.current = Date.now();
      recorder.start();
      setIsRecording(true);
      startLevelMeter(stream);
      timerRef.current = setInterval(() => {
        setElapsedMs(Date.now() - startTimeRef.current);
      }, 100);
    },
    [cleanupStream, disabled, isRecording, onError, onRecorded, startLevelMeter, stopLevelMeter, stopTimer]
  );

  const stopRecording = useCallback((cancel: boolean) => {
    cancelledRef.current = cancel;
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    } else {
      stopTimer();
      stopLevelMeter();
      cleanupStream();
      setIsRecording(false);
      setElapsedMs(0);
      setDragX(0);
    }
  }, [cleanupStream, stopLevelMeter, stopTimer]);

  function handlePointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    startRecording(event.clientX);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
    if (!isRecording) return;
    const delta = Math.max(0, pointerStartXRef.current - event.clientX);
    setDragX(delta);
  }

  function handlePointerUp() {
    if (!isRecording) return;
    stopRecording(dragX > CANCEL_SWIPE_PX);
  }

  const seconds = Math.floor(elapsedMs / 1000);
  const timeLabel = `${Math.floor(seconds / 60)}:${(seconds % 60).toString().padStart(2, "0")}`;
  const nearCancel = dragX > CANCEL_SWIPE_PX / 2;

  return (
    <div className="relative flex items-center">
      {isRecording && (
        <div className="absolute right-full mr-2 flex items-center gap-2 whitespace-nowrap rounded-full bg-neutral-100 px-3 py-1.5 text-xs text-neutral-700">
          <span className="h-2 w-2 flex-shrink-0 animate-pulse rounded-full bg-red-500" />
          <span className="tabular-nums">{timeLabel}</span>
          <span className="flex items-end gap-0.5" aria-hidden="true">
            {levels.map((level, index) => (
              <span
                key={index}
                className="w-0.5 rounded-full bg-red-400"
                style={{ height: `${4 + level * 12}px` }}
              />
            ))}
          </span>
          <span className={nearCancel ? "font-medium text-red-500" : "text-neutral-400"}>
            {nearCancel ? "Loslassen zum Abbrechen" : "← Wischen zum Abbrechen"}
          </span>
        </div>
      )}
      <button
        type="button"
        disabled={disabled}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={() => stopRecording(true)}
        aria-label="Sprachnachricht aufnehmen (gedrückt halten)"
        style={
          isRecording
            ? { transform: `translateX(-${Math.min(dragX, CANCEL_SWIPE_PX)}px)` }
            : undefined
        }
        className={`rounded-full p-2 transition-colors ${
          isRecording ? "bg-red-500 text-white" : "text-neutral-500 hover:bg-neutral-100"
        } disabled:opacity-50`}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          className="h-5 w-5"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 0 1-14 0M12 18v3" />
        </svg>
      </button>
    </div>
  );
}
