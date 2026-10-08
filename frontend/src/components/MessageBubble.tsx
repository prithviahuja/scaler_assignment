"use client";

import {
  Check,
  CheckCheck,
  Clock,
  CornerUpLeft,
  Download,
  FileText,
  Forward,
  Pencil,
  MoreVertical,
  Timer,
  TriangleAlert,
  Trash2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import clsx from "clsx";

import { assetUrl } from "@/lib/api";
import { avatarColor } from "@/lib/avatar";
import { formatBubbleTimestamp, formatBytes } from "@/lib/format";
import type { Message, MessageStatus } from "@/lib/types";
import { Avatar } from "@/components/ui/Avatar";
import { VoiceNote } from "@/components/VoiceNote";

const QUICK_REACTIONS = ["❤️", "👍", "👎", "😂", "😮", "😢"];

interface MessageBubbleProps {
  message: Message;
  isMine: boolean;
  isGroup: boolean;
  /** First bubble of a run by the same author — shows the avatar and name. */
  startsGroup: boolean;
  /** Last of a run — gets the tail corner, like Signal. */
  endsGroup: boolean;
  myUserId: number;
  onReply: (message: Message) => void;
  onReact: (message: Message, emoji: string) => void;
  onDelete: (message: Message) => void;
  onEdit: (message: Message) => void;
  onForward: (message: Message) => void;
  onRetry: (message: Message) => void;
}

export function MessageBubble({
  message,
  isMine,
  isGroup,
  startsGroup,
  endsGroup,
  myUserId,
  onReply,
  onReact,
  onDelete,
  onEdit,
  onForward,
  onRetry,
}: MessageBubbleProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onClickAway = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onClickAway);
    return () => document.removeEventListener("mousedown", onClickAway);
  }, [menuOpen]);

  if (message.kind === "system") {
    return (
      <div className="my-3 flex justify-center px-4">
        <span className="rounded-full bg-surface-active px-3 py-1 text-center text-[12px] text-text-secondary">
          {message.body}
        </span>
      </div>
    );
  }

  const deleted = Boolean(message.deleted_at);
  const failed = message.status === "failed";
  // Signal lets a photo fill its bubble edge to edge, with any caption and the
  // timestamp padded underneath it.
  const mediaBubble = !deleted && message.kind === "image" && Boolean(message.attachment_url);

  return (
    <div
      ref={containerRef}
      className={clsx(
        "group/message relative flex gap-2 px-4",
        isMine ? "justify-end" : "justify-start",
        endsGroup ? "mb-2" : "mb-0.5",
      )}
    >
      {/* Group chats show the sender's avatar beside incoming runs. */}
      {!isMine && isGroup && (
        <div className="w-8 shrink-0 self-end">
          {endsGroup && (
            <Avatar
              name={message.sender_name ?? "?"}
              color={senderColor(message)}
              size="sm"
            />
          )}
        </div>
      )}

      <div
        className={clsx(
          "flex min-w-0 max-w-[min(32rem,72%)] flex-col",
          isMine ? "items-end" : "items-start",
        )}
      >
        {!isMine && isGroup && startsGroup && (
          <span
            className="mb-1 px-1 text-[12.5px] font-semibold"
            style={{ color: avatarColor(senderColor(message)) }}
          >
            {message.sender_name}
          </span>
        )}

        <div className="relative flex items-center gap-1">
          {/* Hover actions sit outside the bubble, on the inner side. */}
          {isMine && !deleted && (
            <BubbleActions
              align="left"
              menuOpen={menuOpen}
              onToggleMenu={() => setMenuOpen((open) => !open)}
              onReply={() => onReply(message)}
            />
          )}

          <div
            onDoubleClick={() => !deleted && onReact(message, "❤️")}
            className={clsx(
              "relative animate-bubble-in overflow-hidden text-[14.5px] leading-[1.35]",
              mediaBubble ? "p-1" : "px-3 py-2",
              isMine
                ? "bg-bubble-out text-bubble-out-text"
                : "bg-bubble-in text-bubble-in-text",
              deleted && "italic opacity-70",
              failed && "ring-2 ring-[#CF163E]",
              bubbleRadius(isMine, startsGroup, endsGroup),
            )}
          >
            {message.is_forwarded && (
              <div
                className={clsx(
                  "mb-1 flex items-center gap-1 text-[11.5px] italic opacity-70",
                  mediaBubble && "px-2 pt-1",
                )}
              >
                <Forward size={11} /> Forwarded
              </div>
            )}

            {message.reply_to && (
              <div className={clsx(mediaBubble && "px-1.5 pt-1")}>
                <QuotedMessage quote={message.reply_to} isMine={isMine} />
              </div>
            )}

            {!deleted && message.attachment_url && message.kind === "audio" && (
              <VoiceNote message={message} isMine={isMine} />
            )}

            {!deleted && message.attachment_url && message.kind !== "audio" && (
              <Attachment message={message} isMine={isMine} />
            )}

            {(deleted || message.body) && (
              <div
                className={clsx(
                  "whitespace-pre-wrap break-words",
                  mediaBubble && "px-2 pt-1",
                )}
              >
                {deleted ? "This message was deleted" : message.body}
              </div>
            )}

            <div
              className={clsx(
                "mt-1 flex items-center justify-end gap-1 text-[11px]",
                mediaBubble && "px-2 pb-1",
                isMine ? "text-white/70" : "text-text-secondary",
              )}
            >
              {message.expires_at && <Timer size={11} aria-label="Disappearing message" />}
              {message.edited_at && !deleted && <span className="italic">edited</span>}
              <span>{formatBubbleTimestamp(message.created_at)}</span>
              {isMine && <StatusTicks status={message.status} />}
            </div>
          </div>

          {!isMine && !deleted && (
            <BubbleActions
              align="right"
              menuOpen={menuOpen}
              onToggleMenu={() => setMenuOpen((open) => !open)}
              onReply={() => onReply(message)}
            />
          )}

          {menuOpen && (
            <ContextMenu
              isMine={isMine}
              onReact={(emoji) => {
                onReact(message, emoji);
                setMenuOpen(false);
              }}
              onReply={() => {
                onReply(message);
                setMenuOpen(false);
              }}
              onForward={() => {
                onForward(message);
                setMenuOpen(false);
              }}
              onEdit={
                isMine && message.kind === "text"
                  ? () => {
                      onEdit(message);
                      setMenuOpen(false);
                    }
                  : undefined
              }
              onDelete={
                isMine
                  ? () => {
                      onDelete(message);
                      setMenuOpen(false);
                    }
                  : undefined
              }
            />
          )}
        </div>

        {message.reactions.length > 0 && (
          <ReactionRow
            message={message}
            isMine={isMine}
            myUserId={myUserId}
            onReact={onReact}
          />
        )}

        {failed && (
          <button
            type="button"
            onClick={() => onRetry(message)}
            className="mt-1 flex items-center gap-1 px-1 text-[11.5px] font-semibold text-[#CF163E] hover:underline"
          >
            <TriangleAlert size={12} /> Not delivered — tap to retry
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Signal keeps every corner at 18px except on the side where a run continues:
 * a bubble with one above it squares its top corner, one with a bubble below
 * squares its bottom corner. A run then reads as a single block.
 */
function bubbleRadius(isMine: boolean, startsGroup: boolean, endsGroup: boolean): string {
  return clsx(
    "rounded-bubble",
    isMine
      ? [!startsGroup && "rounded-tr-[6px]", !endsGroup && "rounded-br-[6px]"]
      : [!startsGroup && "rounded-tl-[6px]", !endsGroup && "rounded-bl-[6px]"],
  );
}

function senderColor(message: Message): string {
  // The backend does not send a per-message colour; derive a stable one.
  const seed = String(message.sender_id ?? 0);
  const palette = ["ultramarine", "plum", "forest", "crimson", "teal", "indigo", "burlap", "steel"];
  return palette[Number(seed) % palette.length];
}

function StatusTicks({ status }: { status: MessageStatus }) {
  if (status === "sending") return <Clock size={12} aria-label="Sending" />;
  if (status === "failed") return <TriangleAlert size={12} aria-label="Failed" />;
  if (status === "sent") return <Check size={13} aria-label="Sent" />;
  if (status === "delivered") return <CheckCheck size={13} aria-label="Delivered" />;
  // Read: Signal tints the double check.
  return <CheckCheck size={13} className="text-white" aria-label="Read" />;
}

/**
 * Images render inline and open full-size in a new tab; anything else becomes
 * a download chip with its name and size, as Signal does.
 */
function Attachment({ message, isMine }: { message: Message; isMine: boolean }) {
  const href = assetUrl(message.attachment_url);
  const name = message.attachment_name ?? "attachment";
  const captioned = Boolean(message.body);

  if (message.kind === "image") {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="block overflow-hidden rounded-[14px]"
      >
        {/* Plain <img>: these are user uploads served by the API, not static
            assets Next.js can optimise at build time. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={href}
          alt={name}
          loading="lazy"
          className="max-h-[320px] w-auto max-w-full object-cover"
        />
      </a>
    );
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      download={name}
      className={clsx(
        "flex items-center gap-2.5 rounded-lg px-2.5 py-2 transition-colors",
        isMine ? "bg-black/15 hover:bg-black/25" : "bg-black/5 hover:bg-black/10 dark:bg-white/10 dark:hover:bg-white/20",
        captioned && "mb-1.5",
      )}
    >
      <span
        className={clsx(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
          isMine ? "bg-white/25" : "bg-signal-blue text-white",
        )}
      >
        <FileText size={17} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13.5px] font-medium">{name}</span>
        <span className={clsx("block text-[11.5px]", isMine ? "text-white/70" : "text-text-secondary")}>
          {formatBytes(message.attachment_size)}
        </span>
      </span>
      <Download size={15} className="shrink-0 opacity-70" />
    </a>
  );
}

function QuotedMessage({
  quote,
  isMine,
}: {
  quote: NonNullable<Message["reply_to"]>;
  isMine: boolean;
}) {
  return (
    <div
      className={clsx(
        "mb-1.5 rounded-md border-l-[3px] px-2 py-1.5 text-[13px]",
        isMine ? "border-white/70 bg-black/15" : "border-signal-blue bg-black/5 dark:bg-white/10",
      )}
    >
      <div className="font-semibold opacity-90">{quote.sender_name ?? "Unknown"}</div>
      <div className="line-clamp-2 opacity-75">
        {quote.body || "Message unavailable"}
      </div>
    </div>
  );
}

function BubbleActions({
  align,
  menuOpen,
  onToggleMenu,
  onReply,
}: {
  align: "left" | "right";
  menuOpen: boolean;
  onToggleMenu: () => void;
  onReply: () => void;
}) {
  return (
    <div
      className={clsx(
        "flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover/message:opacity-100 focus-within:opacity-100",
        menuOpen && "opacity-100",
        align === "left" ? "order-first" : "order-last",
      )}
    >
      <button
        type="button"
        onClick={onReply}
        aria-label="Reply to message"
        className="rounded-full p-1.5 text-text-secondary hover:bg-surface-hover"
      >
        <CornerUpLeft size={15} />
      </button>
      <button
        type="button"
        onClick={onToggleMenu}
        aria-label="More message actions"
        aria-expanded={menuOpen}
        className="rounded-full p-1.5 text-text-secondary hover:bg-surface-hover"
      >
        <MoreVertical size={15} />
      </button>
    </div>
  );
}

function ContextMenu({
  isMine,
  onReact,
  onReply,
  onForward,
  onEdit,
  onDelete,
}: {
  isMine: boolean;
  onReact: (emoji: string) => void;
  onReply: () => void;
  onForward: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  return (
    <div
      className={clsx(
        "absolute bottom-full z-30 mb-2 w-max rounded-xl bg-surface p-1.5 shadow-2xl",
        isMine ? "right-0" : "left-0",
      )}
      style={{ border: "1px solid var(--divider)" }}
      role="menu"
    >
      <div className="flex gap-0.5 pb-1.5" style={{ borderBottom: "1px solid var(--divider)" }}>
        {QUICK_REACTIONS.map((emoji) => (
          <button
            key={emoji}
            type="button"
            onClick={() => onReact(emoji)}
            aria-label={`React with ${emoji}`}
            className="rounded-full px-1.5 py-1 text-[18px] transition-transform hover:scale-125"
          >
            {emoji}
          </button>
        ))}
      </div>
      <button
        type="button"
        role="menuitem"
        onClick={onReply}
        className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13.5px] text-text-primary hover:bg-surface-hover"
      >
        <CornerUpLeft size={15} /> Reply
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={onForward}
        className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13.5px] text-text-primary hover:bg-surface-hover"
      >
        <Forward size={15} /> Forward
      </button>
      {onEdit && (
        <button
          type="button"
          role="menuitem"
          onClick={onEdit}
          className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13.5px] text-text-primary hover:bg-surface-hover"
        >
          <Pencil size={15} /> Edit
        </button>
      )}
      {onDelete && (
        <button
          type="button"
          role="menuitem"
          onClick={onDelete}
          className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13.5px] text-[#CF163E] hover:bg-surface-hover"
        >
          <Trash2 size={15} /> Delete for everyone
        </button>
      )}
    </div>
  );
}

function ReactionRow({
  message,
  isMine,
  myUserId,
  onReact,
}: {
  message: Message;
  isMine: boolean;
  myUserId: number;
  onReact: (message: Message, emoji: string) => void;
}) {
  return (
    // The bubble is `relative`, so a statically-positioned row would paint
    // *behind* it. `relative z-10` lifts the pills onto the bubble's edge, and
    // the surface-coloured ring punches them out of it the way Signal does.
    <div
      className={clsx(
        "relative z-10 -mt-2.5 flex gap-1 px-1",
        isMine ? "justify-end" : "justify-start",
      )}
    >
      {message.reactions.map((reaction) => {
        const mine = reaction.user_ids.includes(myUserId);
        return (
          <button
            key={reaction.emoji}
            type="button"
            onClick={() => onReact(message, reaction.emoji)}
            title={`${reaction.user_ids.length} reacted`}
            style={{ borderColor: "var(--surface)" }}
            className={clsx(
              "flex items-center gap-1 rounded-full border-2 px-2 py-0.5 text-[12px] leading-[1.4] shadow-sm transition-colors",
              mine
                ? "bg-signal-blue text-white"
                : "bg-surface-active text-text-primary hover:bg-surface-hover",
            )}
          >
            <span>{reaction.emoji}</span>
            {reaction.user_ids.length > 1 && <span>{reaction.user_ids.length}</span>}
          </button>
        );
      })}
    </div>
  );
}
