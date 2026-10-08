"use client";

import { ArrowLeft, BellOff, Info, Phone, Search, Timer, Video } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";

import { Avatar } from "@/components/ui/Avatar";
import { Composer } from "@/components/Composer";
import { ForwardModal } from "@/components/ForwardModal";
import { MessageBubble } from "@/components/MessageBubble";
import { formatDateDivider, formatPresence, formatTimer, sameDay } from "@/lib/format";
import type { Conversation, Message } from "@/lib/types";
import { useAppStore } from "@/store/useAppStore";

/**
 * Shared empty values. A selector must return a stable reference — building
 * `?? []` inline makes zustand see a new snapshot on every render and loop.
 */
const NO_MESSAGES: Message[] = [];
const NO_TYPING: Record<number, { displayName: string; at: number }> = {};

interface ChatPaneProps {
  conversation: Conversation;
  onOpenInfo: () => void;
  onBack: () => void;
  onComingSoon: (feature: string) => void;
}

export function ChatPane({ conversation, onOpenInfo, onBack, onComingSoon }: ChatPaneProps) {
  const me = useAppStore((state) => state.me);
  const messages = useAppStore((state) => state.messages[conversation.id] ?? NO_MESSAGES);
  const typing = useAppStore((state) => state.typing[conversation.id] ?? NO_TYPING);
  const onlineUserIds = useAppStore((state) => state.onlineUserIds);
  const sendMessage = useAppStore((state) => state.sendMessage);
  const reactToMessage = useAppStore((state) => state.reactToMessage);
  const deleteMessage = useAppStore((state) => state.deleteMessage);
  const retryMessage = useAppStore((state) => state.retryMessage);
  const editMessage = useAppStore((state) => state.editMessage);
  const unreadBoundary = useAppStore((state) => state.unreadBoundary[conversation.id] ?? null);
  const notifyTyping = useAppStore((state) => state.notifyTyping);
  const loadOlder = useAppStore((state) => state.loadOlder);

  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [editing, setEditing] = useState<Message | null>(null);
  const [forwarding, setForwarding] = useState<Message | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const pinnedToBottom = useRef(true);

  const isGroup = conversation.type === "group";
  const other = conversation.other_user;
  const online = other ? onlineUserIds.includes(other.id) : false;
  const typingNames = Object.values(typing).map((entry) => entry.displayName);

  // Reset the reply draft when switching threads.
  useEffect(() => {
    setReplyTo(null);
    setEditing(null);
    setForwarding(null);
    pinnedToBottom.current = true;
  }, [conversation.id]);

  // Follow new messages only when the user is already at the bottom, so
  // reading history is not interrupted.
  useEffect(() => {
    if (pinnedToBottom.current) {
      bottomRef.current?.scrollIntoView({ block: "end" });
    }
  }, [messages.length, typingNames.length]);

  const onScroll = useCallback(() => {
    const node = scrollRef.current;
    if (!node) return;
    const distanceFromBottom = node.scrollHeight - node.scrollTop - node.clientHeight;
    pinnedToBottom.current = distanceFromBottom < 120;
    if (node.scrollTop < 80) void loadOlder(conversation.id);
  }, [conversation.id, loadOlder]);

  /**
   * The first incoming message after the frozen read boundary gets the
   * "unread messages" separator above it.
   */
  const firstUnreadId = useMemo(() => {
    if (!unreadBoundary || !me) return null;
    const boundary = new Date(unreadBoundary).getTime();
    const found = messages.find(
      (message) =>
        message.sender_id !== null &&
        message.sender_id !== me.id &&
        message.kind !== "system" &&
        new Date(message.created_at).getTime() > boundary,
    );
    return found?.id ?? null;
  }, [messages, unreadBoundary, me]);

  /**
   * In a group, the last of my messages shows who has read it so far —
   * Signal's small avatar row under the final bubble.
   */
  const lastOwnMessageId = useMemo(() => {
    if (!me) return null;
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (message.sender_id === me.id && message.kind !== "system" && message.id > 0) {
        return message.id;
      }
    }
    return null;
  }, [messages, me]);

  /** Precompute run boundaries so bubbles know which corners to square. */
  const rows = useMemo(() => {
    return messages.map((message, index) => {
      const previous = messages[index - 1];
      const next = messages[index + 1];
      const newDay = !previous || !sameDay(previous.created_at, message.created_at);
      const sameAuthorAsPrevious =
        previous !== undefined &&
        previous.sender_id === message.sender_id &&
        previous.kind !== "system" &&
        message.kind !== "system" &&
        !newDay;
      const sameAuthorAsNext =
        next !== undefined &&
        next.sender_id === message.sender_id &&
        next.kind !== "system" &&
        message.kind !== "system" &&
        sameDay(message.created_at, next.created_at);
      return {
        message,
        showDateDivider: newDay,
        startsGroup: !sameAuthorAsPrevious,
        endsGroup: !sameAuthorAsNext,
      };
    });
  }, [messages]);

  if (!me) return null;

  return (
    <div className="flex h-full min-w-0 flex-col bg-surface">
      {/* ---------------------------------------------------------- header */}
      <header
        className="flex shrink-0 items-center gap-3 bg-surface px-4 py-2.5"
        style={{ borderBottom: "1px solid var(--divider)" }}
      >
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to chats"
          className="-ml-2 rounded-full p-2 text-text-primary hover:bg-surface-hover md:hidden"
        >
          <ArrowLeft size={20} />
        </button>

        <button
          type="button"
          onClick={onOpenInfo}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-1 py-0.5 text-left hover:bg-surface-hover"
        >
          <Avatar
            name={conversation.title}
            color={conversation.avatar_color}
            isGroup={isGroup}
            online={online}
          />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <p className="truncate text-[15px] font-semibold text-text-primary">
                {conversation.title}
              </p>
              {conversation.is_muted && (
                <BellOff size={13} className="shrink-0 text-text-secondary" />
              )}
              {conversation.disappearing_seconds > 0 && (
                <Timer size={13} className="shrink-0 text-text-secondary" />
              )}
            </div>
            <p className="truncate text-[12.5px] text-text-secondary">
              {typingNames.length > 0
                ? isGroup
                  ? `${typingNames[0]} is typing…`
                  : "typing…"
                : isGroup
                  ? `${conversation.members.length} members`
                  : other
                    ? formatPresence({ is_online: online, last_seen_at: other.last_seen_at })
                    : ""}
            </p>
          </div>
        </button>

        <div className="flex shrink-0 items-center gap-0.5">
          <HeaderButton label="Voice call" onClick={() => onComingSoon("Voice calls")}>
            <Phone size={18} />
          </HeaderButton>
          <HeaderButton label="Video call" onClick={() => onComingSoon("Video calls")}>
            <Video size={18} />
          </HeaderButton>
          {/* Secondary actions are dropped on phones so the title keeps its
              room; tapping the header still opens the details pane. */}
          <HeaderButton
            label="Search in conversation"
            className="hidden sm:inline-flex"
            onClick={() => onComingSoon("In-chat search")}
          >
            <Search size={18} />
          </HeaderButton>
          <HeaderButton
            label="Conversation info"
            className="hidden sm:inline-flex"
            onClick={onOpenInfo}
          >
            <Info size={18} />
          </HeaderButton>
        </div>
      </header>

      {/* ------------------------------------------------------- messages */}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="chat-canvas min-h-0 flex-1 overflow-y-auto scroll-thin"
      >
        {/* `justify-end` keeps a short thread pinned to the bottom, the way
            Signal does, without breaking scrolling once it overflows. */}
        <div className="flex min-h-full flex-col justify-end py-4">
        {conversation.disappearing_seconds > 0 && (
          <p className="mx-auto mb-3 flex w-max items-center gap-1.5 rounded-full bg-surface-active px-3 py-1 text-[12px] text-text-secondary">
            <Timer size={12} />
            Disappearing messages: {formatTimer(conversation.disappearing_seconds)}
          </p>
        )}

        {rows.length === 0 && (
          <p className="px-6 py-10 text-center text-[13.5px] text-text-secondary">
            No messages yet. Say hello to {conversation.title}.
          </p>
        )}

        {rows.map(({ message, showDateDivider, startsGroup, endsGroup }) => (
          <div key={message.client_id ?? message.id}>
            {showDateDivider && (
              <div className="my-4 flex justify-center">
                <span className="rounded-full bg-surface-active px-3 py-1 text-[11.5px] font-semibold uppercase tracking-wide text-text-secondary">
                  {formatDateDivider(message.created_at)}
                </span>
              </div>
            )}

            {message.id === firstUnreadId && <UnreadDivider />}

            <MessageBubble
              message={message}
              isMine={message.sender_id === me.id}
              isGroup={isGroup}
              startsGroup={startsGroup}
              endsGroup={endsGroup}
              myUserId={me.id}
              onReply={setReplyTo}
              onReact={(target, emoji) => reactToMessage(conversation.id, target.id, emoji)}
              onDelete={(target) => deleteMessage(conversation.id, target.id)}
              onEdit={setEditing}
              onForward={setForwarding}
              onRetry={(target) =>
                target.client_id && retryMessage(conversation.id, target.client_id)
              }
            />

            {isGroup && message.id === lastOwnMessageId && message.read_by.length > 0 && (
              <ReadReceipts conversation={conversation} readBy={message.read_by} />
            )}
          </div>
        ))}

        {typingNames.length > 0 && <TypingBubble names={typingNames} isGroup={isGroup} />}
        <div ref={bottomRef} />
        </div>
      </div>

      {/* ------------------------------------------------------- composer */}
      <Composer
        conversationTitle={conversation.title}
        replyTo={replyTo}
        onCancelReply={() => setReplyTo(null)}
        onSend={(body, attachment) => {
          pinnedToBottom.current = true;
          void sendMessage({
            conversationId: conversation.id,
            body,
            replyToId: replyTo?.id ?? null,
            attachment,
          });
          setReplyTo(null);
        }}
        onTyping={() => notifyTyping(conversation.id)}
        focusKey={conversation.id}
        editing={editing}
        onCancelEdit={() => setEditing(null)}
        onSubmitEdit={(body) => {
          if (editing) void editMessage(conversation.id, editing.id, body);
          setEditing(null);
        }}
      />

      {forwarding && (
        <ForwardModal
          message={forwarding}
          sourceConversationId={conversation.id}
          onClose={() => setForwarding(null)}
        />
      )}
    </div>
  );
}

function HeaderButton({
  label,
  onClick,
  className,
  children,
}: {
  label: string;
  onClick: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={clsx(
        "rounded-full p-2 text-text-primary hover:bg-surface-hover",
        className,
      )}
    >
      {children}
    </button>
  );
}

/** Signal's red "unread messages" rule across the thread. */
function UnreadDivider() {
  return (
    <div className="my-3 flex items-center gap-3 px-4">
      <span className="h-px flex-1 bg-[#CF163E]/50" />
      <span className="text-[11.5px] font-semibold uppercase tracking-wide text-[#CF163E]">
        Unread messages
      </span>
      <span className="h-px flex-1 bg-[#CF163E]/50" />
    </div>
  );
}

/** Small stack of avatars under my last group message showing who has read it. */
function ReadReceipts({
  conversation,
  readBy,
}: {
  conversation: Conversation;
  readBy: number[];
}) {
  const readers = conversation.members.filter((member) => readBy.includes(member.user.id));
  if (readers.length === 0) return null;

  const shown = readers.slice(0, 5);
  const overflow = readers.length - shown.length;

  return (
    <div
      className="mb-2 mt-0.5 flex items-center justify-end gap-1 px-4"
      title={`Read by ${readers.map((member) => member.user.display_name).join(", ")}`}
    >
      <span className="mr-0.5 text-[11px] text-text-secondary">Read by</span>
      {shown.map((member) => (
        <Avatar
          key={member.user.id}
          name={member.user.display_name}
          color={member.user.avatar_color}
          size="xs"
        />
      ))}
      {overflow > 0 && (
        <span className="text-[11px] text-text-secondary">+{overflow}</span>
      )}
    </div>
  );
}

function TypingBubble({ names, isGroup }: { names: string[]; isGroup: boolean }) {
  return (
    <div className="flex items-end gap-2 px-4 pb-1">
      {isGroup && <div className="w-8 shrink-0" />}
      <div className="flex items-center gap-1 rounded-bubble bg-bubble-in px-3.5 py-3">
        <span className="typing-dot h-1.5 w-1.5 rounded-full bg-text-secondary" />
        <span className="typing-dot h-1.5 w-1.5 rounded-full bg-text-secondary" />
        <span className="typing-dot h-1.5 w-1.5 rounded-full bg-text-secondary" />
      </div>
      {isGroup && names[0] && (
        <span className="pb-1 text-[11.5px] text-text-secondary">{names[0]}</span>
      )}
    </div>
  );
}
