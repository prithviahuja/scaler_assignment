/**
 * Browser voice recording via MediaRecorder.
 *
 * Chrome and Firefox record to webm/opus; Safari only offers mp4/aac, so the
 * mime type is negotiated rather than hard-coded. The microphone track is
 * always stopped on finish, otherwise the browser leaves the recording
 * indicator on after the user is done.
 */

const PREFERRED_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/mp4",
];

export interface Recording {
  file: File;
  durationMs: number;
}

export function isRecordingSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof navigator !== "undefined" &&
    Boolean(navigator.mediaDevices?.getUserMedia) &&
    typeof MediaRecorder !== "undefined"
  );
}

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return PREFERRED_MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
}

export class VoiceRecorder {
  private recorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private chunks: BlobPart[] = [];
  private startedAt = 0;

  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeType = pickMimeType();
    this.recorder = new MediaRecorder(this.stream, mimeType ? { mimeType } : undefined);
    this.chunks = [];
    this.recorder.ondataavailable = (event) => {
      if (event.data.size > 0) this.chunks.push(event.data);
    };
    this.startedAt = Date.now();
    this.recorder.start();
  }

  get elapsedMs(): number {
    return this.startedAt ? Date.now() - this.startedAt : 0;
  }

  /** Stop and hand back the recording, or null if nothing was captured. */
  stop(): Promise<Recording | null> {
    return new Promise((resolve) => {
      const recorder = this.recorder;
      if (!recorder || recorder.state === "inactive") {
        this.releaseMicrophone();
        resolve(null);
        return;
      }

      recorder.onstop = () => {
        const durationMs = this.elapsedMs;
        // `mimeType` can come back empty on some builds; fall back to webm.
        const type = recorder.mimeType?.split(";")[0] || "audio/webm";
        const blob = new Blob(this.chunks, { type });
        this.releaseMicrophone();

        if (blob.size === 0) {
          resolve(null);
          return;
        }
        const extension = type.includes("mp4") ? "m4a" : type.includes("ogg") ? "ogg" : "webm";
        resolve({
          file: new File([blob], `voice-message.${extension}`, { type }),
          durationMs,
        });
      };
      recorder.stop();
    });
  }

  /** Abandon the recording without producing a file. */
  cancel(): void {
    if (this.recorder && this.recorder.state !== "inactive") {
      this.recorder.onstop = null;
      this.recorder.stop();
    }
    this.releaseMicrophone();
    this.chunks = [];
  }

  private releaseMicrophone(): void {
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.recorder = null;
  }
}

/** mm:ss for the recording timer and the player. */
export function formatDuration(ms: number | null | undefined): string {
  const total = Math.max(0, Math.round((ms ?? 0) / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
