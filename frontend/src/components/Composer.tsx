"use client";

import { Check, FileText, Loader2, Mic, Paperclip, Send, Smile, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import clsx from "clsx";

import { api, assetUrl } from "@/lib/api";
import { formatBytes } from "@/lib/format";
import { VoiceRecorder, formatDuration, isRecordingSupported } from "@/lib/recorder";
import type { Message, UploadedAttachment } from "@/lib/types";
import { useAppStore } from "@/store/useAppStore";

const EMOJI = [
  "😀", "😂", "🥹", "😊", "😍", "🤔", "😅", "🙃",
  "👍", "👎", "🙏", "👏", "🔥", "🎉", "❤️", "💙",
  "✅", "❌", "💯", "🚀", "☕", "🌙", "📷", "📎",
];

/** Mirrors the backend's allow-list so the picker only offers valid types. */
const ACCEPTED_TYPES =
  "image/jpeg,image/png,image/gif,image/webp,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip,.txt,.csv,.json";

const MAX_UPLOAD_MB = 15;

interface ComposerProps {
  conversationTitle: string;
  replyTo: Message | null;
  onCancelReply: () => void;
  onSend: (body: string, attachment: UploadedAttachment | null) => void;
  onTyping: () => void;
  /** Focus the input when the thread changes. */
  focusKey: number;
  /** When set, the composer edits this message instead of sending a new one. */
  editing: Message | null;
  onCancelEdit: () => void;
  onSubmitEdit: (body: string) => void;
}

/** Signal's composer: auto-growing textarea, Enter sends, Shift+Enter newline. */
export function Composer({
  conversationTitle,
  replyTo,
  onCancelReply,
  onSend,
  onTyping,
  focusKey,
  editing,
  onCancelEdit,
  onSubmitEdit,
}: ComposerProps) {
  const pushToast = useAppStore((state) => state.pushToast);

  const [value, setValue] = useState("");
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [attachment, setAttachment] = useState<UploadedAttachment | null>(null);
  const [uploading, setUploading] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordedMs, setRecordedMs] = useState(0);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recorderRef = useRef<VoiceRecorder | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    textareaRef.current?.focus();
    // Switching threads abandons any staged attachment.
    setAttachment(null);
    setUploading(false);
  }, [focusKey]);

  useEffect(() => {
    if (replyTo) textareaRef.current?.focus();
  }, [replyTo]);

  // Entering edit mode loads the existing text; leaving clears the draft.
  useEffect(() => {
    if (editing) {
      setValue(editing.body);
      setAttachment(null);
      textareaRef.current?.focus();
    } else {
      setValue("");
    }
  }, [editing]);

  // Never leave the microphone running if the component goes away mid-record.
  useEffect(() => {
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
      recorderRef.current?.cancel();
    };
  }, []);

  // Grow to fit, up to roughly six lines.
  useEffect(() => {
    const node = textareaRef.current;
    if (!node) return;
    node.style.height = "auto";
    node.style.height = `${Math.min(node.scrollHeight, 140)}px`;
  }, [value]);

  /** Upload as soon as a file is chosen, so Send is instant afterwards. */
  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
      pushToast({
        title: "File is too large",
        description: `Attachments must be ${MAX_UPLOAD_MB} MB or smaller.`,
        tone: "error",
      });
      return;
    }

    setUploading(true);
    setEmojiOpen(false);
    try {
      setAttachment(await api.uploadFile(file));
      textareaRef.current?.focus();
    } catch (error) {
      pushToast({
        title: "Could not attach that file",
        description: error instanceof Error ? error.message : undefined,
        tone: "error",
      });
    } finally {
      setUploading(false);
      // Allow re-picking the same file straight after a failure.
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const startRecording = async () => {
    if (!isRecordingSupported()) {
      pushToast({
        title: "Recording is not supported here",
        description: "Try Chrome, Edge or Firefox over HTTPS or localhost.",
        tone: "error",
      });
      return;
    }
    const recorder = new VoiceRecorder();
    try {
      await recorder.start();
    } catch {
      pushToast({
        title: "Microphone unavailable",
        description: "Allow microphone access to record a voice message.",
        tone: "error",
      });
      return;
    }
    recorderRef.current = recorder;
    setRecording(true);
    setRecordedMs(0);
    setEmojiOpen(false);
    tickRef.current = setInterval(() => setRecordedMs(recorder.elapsedMs), 100);
  };

  const stopTicking = () => {
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = null;
  };

  const cancelRecording = () => {
    stopTicking();
    recorderRef.current?.cancel();
    recorderRef.current = null;
    setRecording(false);
    setRecordedMs(0);
  };

  /** Stop recording, upload the clip and send it straight away. */
  const finishRecording = async () => {
    stopTicking();
    const recorder = recorderRef.current;
    recorderRef.current = null;
    setRecording(false);

    const result = await recorder?.stop();
    setRecordedMs(0);
    if (!result) return;
    if (result.durationMs < 500) {
      pushToast({ title: "Hold on a little longer to record", tone: "default" });
      return;
    }

    setUploading(true);
    try {
      const uploaded = await api.uploadFile(result.file);
      onSend("", { ...uploaded, duration_ms: result.durationMs });
    } catch (error) {
      pushToast({
        title: "Could not send voice message",
        description: error instanceof Error ? error.message : undefined,
        tone: "error",
      });
    } finally {
      setUploading(false);
    }
  };

  const isEditing = Boolean(editing);
  const canSend = (Boolean(value.trim()) || Boolean(attachment)) && !uploading;
  // An empty box with nothing staged offers the microphone instead of Send.
  const showMicrophone = !isEditing && !value.trim() && !attachment && !uploading;

  const submit = () => {
    if (isEditing) {
      const trimmed = value.trim();
      if (!trimmed) return;
      onSubmitEdit(trimmed);
      return;
    }
    if (!canSend) return;
    onSend(value.trim(), attachment);
    setValue("");
    setAttachment(null);
    setEmojiOpen(false);
  };

  return (
    <div
      className="shrink-0 bg-surface px-4 pb-4 pt-2"
      style={{ borderTop: "1px solid var(--divider)" }}
    >
      {isEditing && (
        <div className="mb-2 flex items-start gap-2 rounded-lg bg-surface-input px-3 py-2">
          <div className="min-w-0 flex-1 border-l-[3px] border-signal-blue pl-2.5">
            <p className="text-[12.5px] font-semibold text-signal-blue">Editing message</p>
            <p className="line-clamp-1 text-[13px] text-text-secondary">
              Press Escape to cancel
            </p>
          </div>
          <button
            type="button"
            onClick={onCancelEdit}
            aria-label="Cancel editing"
            className="rounded-full p-1 text-text-secondary hover:bg-surface-active"
          >
            <X size={15} />
          </button>
        </div>
      )}

      {replyTo && !isEditing && (
        <div className="mb-2 flex items-start gap-2 rounded-lg bg-surface-input px-3 py-2">
          <div className="min-w-0 flex-1 border-l-[3px] border-signal-blue pl-2.5">
            <p className="text-[12.5px] font-semibold text-signal-blue">
              Replying to {replyTo.sender_name ?? "message"}
            </p>
            <p className="line-clamp-1 text-[13px] text-text-secondary">
              {replyTo.body || attachmentLabel(replyTo)}
            </p>
          </div>
          <button
            type="button"
            onClick={onCancelReply}
            aria-label="Cancel reply"
            className="rounded-full p-1 text-text-secondary hover:bg-surface-active"
          >
            <X size={15} />
          </button>
        </div>
      )}

      {/* Staged attachment preview, as Signal shows before you hit send. */}
      {(uploading || attachment) && (
        <div className="mb-2 flex items-center gap-3 rounded-lg bg-surface-input px-3 py-2">
          {uploading ? (
            <>
              <Loader2 size={18} className="animate-spin text-signal-blue" />
              <span className="text-[13px] text-text-secondary">Uploading…</span>
            </>
          ) : attachment ? (
            <>
              {attachment.kind === "image" ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={assetUrl(attachment.url)}
                  alt={attachment.name}
                  className="h-14 w-14 rounded-md object-cover"
                />
              ) : (
                <span className="flex h-14 w-14 items-center justify-center rounded-md bg-surface-active">
                  <FileText size={22} className="text-text-secondary" />
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13.5px] text-text-primary">{attachment.name}</p>
                <p className="text-[12px] text-text-secondary">
                  {formatBytes(attachment.size)} · ready to send
                </p>
              </div>
              <button
                type="button"
                onClick={() => setAttachment(null)}
                aria-label="Remove attachment"
                className="rounded-full p-1.5 text-text-secondary hover:bg-surface-active"
              >
                <X size={16} />
              </button>
            </>
          ) : null}
        </div>
      )}

      {recording ? (
        <div className="flex items-center gap-3 rounded-[20px] bg-surface-input px-3 py-2">
          <span className="relative flex h-3 w-3 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#CF163E] opacity-75" />
            <span className="relative inline-flex h-3 w-3 rounded-full bg-[#CF163E]" />
          </span>
          <span className="text-[14px] font-medium tabular-nums text-text-primary">
            {formatDuration(recordedMs)}
          </span>
          <span className="min-w-0 flex-1 truncate text-[13px] text-text-secondary">
            Recording voice message…
          </span>
          <button
            type="button"
            onClick={cancelRecording}
            aria-label="Discard recording"
            className="rounded-full p-2 text-[#CF163E] hover:bg-surface-active"
          >
            <Trash2 size={18} />
          </button>
          <button
            type="button"
            onClick={finishRecording}
            aria-label="Send voice message"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-signal-blue text-white hover:bg-signal-blue-hover"
          >
            <Check size={17} />
          </button>
        </div>
      ) : (
      <div className="relative flex items-end gap-2">
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED_TYPES}
          className="hidden"
          onChange={(event) => handleFile(event.target.files?.[0])}
        />
        <button
          type="button"
          title="Attach a photo or file"
          aria-label="Attach a photo or file"
          disabled={uploading || isEditing}
          onClick={() => {
            setEmojiOpen(false);
            fileInputRef.current?.click();
          }}
          className="mb-1 rounded-full p-2 text-text-secondary hover:bg-surface-hover disabled:opacity-50"
        >
          <Paperclip size={20} />
        </button>

        <div className="relative flex min-w-0 flex-1 items-end rounded-[20px] bg-surface-input">
          <textarea
            ref={textareaRef}
            rows={1}
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
              if (event.target.value.trim()) onTyping();
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                submit();
              } else if (event.key === "Escape" && isEditing) {
                event.preventDefault();
                onCancelEdit();
              }
            }}
            placeholder={
              isEditing
                ? "Edit your message…"
                : attachment
                  ? "Add a caption…"
                  : `Message ${conversationTitle}`
            }
            aria-label="Message input"
            className="max-h-[140px] w-full resize-none bg-transparent px-4 py-2.5 text-[14.5px] leading-[1.4] text-text-primary placeholder:text-text-secondary focus:outline-none scroll-thin"
          />
          <button
            type="button"
            onClick={() => setEmojiOpen((open) => !open)}
            aria-label="Insert emoji"
            aria-expanded={emojiOpen}
            className="mb-1.5 mr-2 shrink-0 rounded-full p-1.5 text-text-secondary hover:bg-surface-active"
          >
            <Smile size={19} />
          </button>

          {emojiOpen && (
            <div
              className="absolute bottom-full right-0 z-30 mb-2 grid w-64 grid-cols-8 gap-0.5 rounded-xl bg-surface p-2 shadow-2xl"
              style={{ border: "1px solid var(--divider)" }}
            >
              {EMOJI.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => {
                    setValue((current) => current + emoji);
                    textareaRef.current?.focus();
                  }}
                  className="rounded-md p-1 text-[18px] hover:bg-surface-hover"
                >
                  {emoji}
                </button>
              ))}
            </div>
          )}
        </div>

        {showMicrophone ? (
          <button
            type="button"
            onClick={startRecording}
            title="Record a voice message"
            aria-label="Record a voice message"
            className="mb-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-signal-blue text-white transition-colors hover:bg-signal-blue-hover"
          >
            <Mic size={17} />
          </button>
        ) : (
          <button
            type="button"
            onClick={submit}
            disabled={isEditing ? !value.trim() : !canSend}
            aria-label={isEditing ? "Save edit" : "Send message"}
            className={clsx(
              "mb-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white transition-opacity disabled:opacity-40",
              "bg-signal-blue hover:bg-signal-blue-hover",
            )}
          >
            {isEditing ? <Check size={17} /> : <Send size={16} />}
          </button>
        )}
      </div>
      )}
    </div>
  );
}

function attachmentLabel(message: Message): string {
  if (message.kind === "image") return "📷 Photo";
  if (message.kind === "file") return `📎 ${message.attachment_name ?? "Attachment"}`;
  return "";
}
