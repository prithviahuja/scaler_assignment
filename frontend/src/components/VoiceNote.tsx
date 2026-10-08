"use client";

import { Pause, Play } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";

import { assetUrl } from "@/lib/api";
import { formatDuration } from "@/lib/recorder";
import type { Message } from "@/lib/types";

/** Bars are decorative, but seeded from the message id so a given note always
 *  draws the same shape instead of flickering on every render. */
const BAR_COUNT = 27;

function waveform(seed: number): number[] {
  let state = Math.abs(seed) || 1;
  return Array.from({ length: BAR_COUNT }, () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return 0.25 + (state / 2147483648) * 0.75;
  });
}

/** Signal's voice-note player: play/pause, a waveform scrubber and a timer. */
export function VoiceNote({ message, isMine }: { message: Message; isMine: boolean }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);

  const bars = useMemo(() => waveform(message.id), [message.id]);
  const totalMs = message.attachment_duration_ms ?? 0;

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onTime = () => {
      // Recorded webm often reports Infinity for `duration`, so prefer the
      // length the sender measured and fall back to the element.
      const total =
        totalMs > 0
          ? totalMs / 1000
          : Number.isFinite(audio.duration)
            ? audio.duration
            : 0;
      setElapsedMs(audio.currentTime * 1000);
      setProgress(total > 0 ? Math.min(1, audio.currentTime / total) : 0);
    };
    const onEnded = () => {
      setPlaying(false);
      setProgress(0);
      setElapsedMs(0);
      audio.currentTime = 0;
    };

    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("ended", onEnded);
    return () => {
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("ended", onEnded);
    };
  }, [totalMs]);

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
      setPlaying(false);
    } else {
      void audio.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
    }
  };

  const seek = (ratio: number) => {
    const audio = audioRef.current;
    if (!audio || totalMs <= 0) return;
    audio.currentTime = (ratio * totalMs) / 1000;
    setProgress(ratio);
  };

  return (
    // A fixed width keeps the waveform readable; without it the bubble shrinks
    // to the controls and the bars collapse to sub-pixel slivers.
    <div
      className={clsx(
        "flex w-[232px] max-w-full items-center gap-3 py-0.5",
        message.body && "mb-1.5",
      )}
    >
      <audio ref={audioRef} src={assetUrl(message.attachment_url)} preload="metadata" />

      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? "Pause voice message" : "Play voice message"}
        className={clsx(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors",
          isMine
            ? "bg-white/25 text-white hover:bg-white/35"
            : "bg-signal-blue text-white hover:bg-signal-blue-hover",
        )}
      >
        {playing ? <Pause size={16} /> : <Play size={16} className="ml-0.5" />}
      </button>

      <div className="min-w-0 flex-1">
        <button
          type="button"
          aria-label="Seek within voice message"
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            seek(Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)));
          }}
          className="flex h-7 w-full items-end gap-[2px]"
        >
          {bars.map((height, index) => {
            const played = index / BAR_COUNT <= progress;
            return (
              <span
                key={index}
                style={{ height: `${Math.round(height * 100)}%` }}
                className={clsx(
                  "flex-1 rounded-full transition-colors",
                  isMine
                    ? played
                      ? "bg-white"
                      : "bg-white/40"
                    : played
                      ? "bg-signal-blue"
                      : "bg-text-secondary/35",
                )}
              />
            );
          })}
        </button>
        <span
          className={clsx(
            "mt-0.5 block text-[11px] tabular-nums",
            isMine ? "text-white/70" : "text-text-secondary",
          )}
        >
          {formatDuration(playing || progress > 0 ? elapsedMs : totalMs)}
        </span>
      </div>
    </div>
  );
}
