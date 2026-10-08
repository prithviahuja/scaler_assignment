"use client";

import { Pencil, Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";

import { Avatar } from "@/components/ui/Avatar";
import { formatListTimestamp, messagePreview } from "@/lib/format";
import { api } from "@/lib/api";
import type { Conversation, Message, User } from "@/lib/types";
import { useAppStore } from "@/store/useAppStore";

type Filter = "all" | "unread";

interface ConversationListProps {
  onCompose: () => void;
}

/** Signal's left pane: search, All/Unread filter, then the chat rows. */
export function ConversationList({ onCompose }: ConversationListProps) {
  const conversations = useAppStore((state) => state.conversations);
  const activeId = useAppStore((state) => state.activeConversationId);
  const openConversation = useAppStore((state) => state.openConversation);
  const upsertConversation = useAppStore((state) => state.upsertConversation);
  const onlineUserIds = useAppStore((state) => state.onlineUserIds);
  const typing = useAppStore((state) => state.typing);
  const me = useAppStore((state) => state.me);

  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [remoteMatches, setRemoteMatches] = useState<{ people: User[]; messages: Message[] }>({
    people: [],
    messages: [],
  });

  // Local filtering is instant; the server adds people and message-body hits.
  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) {
      setRemoteMatches({ people: [], messages: [] });
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const results = await api.search(term);
        if (!cancelled) {
          setRemoteMatches({ people: results.contacts, messages: results.messages });
        }
      } catch {
        /* search is best-effort */
      }
    }, 220);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  const visible = useMemo(() => {
    const term = query.trim().toLowerCase();
    return conversations.filter((conversation) => {
      if (filter === "unread" && conversation.unread_count === 0) return false;
      if (!term) return true;
      return (
        conversation.title.toLowerCase().includes(term) ||
        (conversation.last_message?.body ?? "").toLowerCase().includes(term)
      );
    });
  }, [conversations, filter, query]);

  const unreadTotal = conversations.reduce((sum, item) => sum + item.unread_count, 0);

  const startDirect = async (user: User) => {
    try {
      const conversation = await api.createDirect(user.id);
      upsertConversation(conversation);
      await openConversation(conversation.id);
      setQuery("");
    } catch {
      /* the toast path is handled in the store for message sends */
    }
  };

  return (
    <div className="flex h-full flex-col bg-surface">
      <header className="shrink-0 px-4 pb-1 pt-4">
        <div className="mb-3 flex items-center justify-between">
          <h1 className="text-[20px] font-bold text-text-primary">Chats</h1>
          <button
            type="button"
            onClick={onCompose}
            title="New chat (Ctrl+N)"
            aria-label="New chat"
            className="rounded-full p-2 text-text-primary hover:bg-surface-hover"
          >
            <Pencil size={18} />
          </button>
        </div>

        <div className="relative mb-3">
          <Search
            size={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary"
          />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search"
            aria-label="Search conversations and contacts"
            className="w-full rounded-full bg-surface-input py-2 pl-9 pr-9 text-[14px] text-text-primary placeholder:text-text-secondary focus:outline-none focus:ring-2 focus:ring-signal-blue"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear search"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full p-1 text-text-secondary hover:bg-surface-active"
            >
              <X size={14} />
            </button>
          )}
        </div>

        <div className="mb-1 flex gap-2">
          <FilterChip active={filter === "all"} onClick={() => setFilter("all")}>
            All
          </FilterChip>
          <FilterChip active={filter === "unread"} onClick={() => setFilter("unread")}>
            Unread{unreadTotal > 0 ? ` ${unreadTotal}` : ""}
          </FilterChip>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto pb-4 scroll-thin">
        {visible.length === 0 && remoteMatches.people.length === 0 && (
          <p className="px-4 py-8 text-center text-[13px] text-text-secondary">
            {query
              ? "No results found."
              : filter === "unread"
                ? "No unread chats."
                : "No chats yet. Start one with the pencil icon."}
          </p>
        )}

        {visible.map((conversation) => (
          <ConversationRow
            key={conversation.id}
            conversation={conversation}
            active={conversation.id === activeId}
            myUserId={me?.id ?? 0}
            online={
              conversation.other_user ? onlineUserIds.includes(conversation.other_user.id) : false
            }
            typingNames={Object.values(typing[conversation.id] ?? {}).map((e) => e.displayName)}
            onSelect={() => openConversation(conversation.id)}
          />
        ))}

        {remoteMatches.people.length > 0 && (
          <>
            <SectionLabel>Contacts</SectionLabel>
            {remoteMatches.people.map((user) => (
              <button
                key={user.id}
                type="button"
                onClick={() => startDirect(user)}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-surface-hover"
              >
                <Avatar
                  name={user.display_name}
                  color={user.avatar_color}
                  online={onlineUserIds.includes(user.id)}
                />
                <div className="min-w-0">
                  <p className="truncate text-[14.5px] text-text-primary">{user.display_name}</p>
                  <p className="truncate text-[13px] text-text-secondary">
                    {user.username ? `@${user.username}` : user.phone}
                  </p>
                </div>
              </button>
            ))}
          </>
        )}

        {remoteMatches.messages.length > 0 && (
          <>
            <SectionLabel>Messages</SectionLabel>
            {remoteMatches.messages.slice(0, 10).map((message) => (
              <button
                key={message.id}
                type="button"
                onClick={() => openConversation(message.conversation_id)}
                className="flex w-full flex-col items-start px-4 py-2.5 text-left hover:bg-surface-hover"
              >
                <span className="text-[13.5px] font-semibold text-text-primary">
                  {message.sender_name ?? "System"}
                </span>
                <span className="line-clamp-2 text-[13px] text-text-secondary">
                  {message.body}
                </span>
              </button>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="px-4 pb-1 pt-4 text-[12px] font-semibold uppercase tracking-wide text-text-secondary">
      {children}
    </h2>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={clsx(
        "rounded-full px-3.5 py-1 text-[13px] font-semibold transition-colors",
        active
          ? "bg-signal-blue text-white"
          : "bg-surface-input text-text-secondary hover:bg-surface-active",
      )}
    >
      {children}
    </button>
  );
}

function ConversationRow({
  conversation,
  active,
  myUserId,
  online,
  typingNames,
  onSelect,
}: {
  conversation: Conversation;
  active: boolean;
  myUserId: number;
  online: boolean;
  typingNames: string[];
  onSelect: () => void;
}) {
  const last = conversation.last_message;
  const unread = conversation.unread_count;

  let preview: string;
  if (typingNames.length > 0) {
    preview =
      conversation.type === "group"
        ? `${typingNames[0]} is typing…`
        : "typing…";
  } else if (!last) {
    preview = "No messages yet";
  } else {
    const fromMe = last.sender_id === myUserId;
    const senderLabel =
      last.kind === "system"
        ? undefined
        : fromMe
          ? "You"
          : conversation.type === "group"
            ? (last.sender_name ?? undefined)
            : undefined;
    preview = messagePreview(last, senderLabel);
  }

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={active ? "true" : undefined}
      className={clsx(
        "flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors",
        active ? "bg-surface-active" : "hover:bg-surface-hover",
      )}
    >
      <Avatar
        name={conversation.title}
        color={conversation.avatar_color}
        isGroup={conversation.type === "group"}
        online={online}
        size="lg"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span
            className={clsx(
              "truncate text-[15px] text-text-primary",
              unread > 0 ? "font-bold" : "font-medium",
            )}
          >
            {conversation.title}
          </span>
          <span
            className={clsx(
              "shrink-0 text-[12px]",
              unread > 0 ? "font-semibold text-signal-blue" : "text-text-secondary",
            )}
          >
            {formatListTimestamp(conversation.last_message_at)}
          </span>
        </div>
        <div className="mt-0.5 flex items-center justify-between gap-2">
          <span
            className={clsx(
              "truncate text-[13.5px]",
              typingNames.length > 0
                ? "italic text-signal-blue"
                : unread > 0
                  ? "font-medium text-text-primary"
                  : "text-text-secondary",
            )}
          >
            {preview}
          </span>
          {unread > 0 && (
            <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-signal-blue px-1.5 text-[11px] font-bold text-white">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}
