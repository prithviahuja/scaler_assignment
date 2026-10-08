"use client";

import { Check, Search } from "lucide-react";
import { useMemo, useState } from "react";
import clsx from "clsx";

import { Avatar } from "@/components/ui/Avatar";
import { Button, Modal } from "@/components/ui/Modal";
import { messagePreview } from "@/lib/format";
import type { Message } from "@/lib/types";
import { useAppStore } from "@/store/useAppStore";

/** Pick one or more chats to copy a message into, like Signal's forward sheet. */
export function ForwardModal({
  message,
  sourceConversationId,
  onClose,
}: {
  message: Message;
  sourceConversationId: number;
  onClose: () => void;
}) {
  const conversations = useAppStore((state) => state.conversations);
  const forwardMessage = useAppStore((state) => state.forwardMessage);
  const onlineUserIds = useAppStore((state) => state.onlineUserIds);

  const [selected, setSelected] = useState<number[]>([]);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);

  const targets = useMemo(() => {
    const term = query.trim().toLowerCase();
    return conversations
      .filter((conversation) => conversation.id !== sourceConversationId)
      .filter((conversation) => !term || conversation.title.toLowerCase().includes(term));
  }, [conversations, sourceConversationId, query]);

  const submit = async () => {
    setBusy(true);
    await forwardMessage(sourceConversationId, message.id, selected);
    setBusy(false);
    onClose();
  };

  return (
    <Modal
      open
      title="Forward message"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy || selected.length === 0}>
            {busy ? "Sending…" : `Send${selected.length ? ` (${selected.length})` : ""}`}
          </Button>
        </>
      }
    >
      <div className="pb-2">
        {/* What is being forwarded, so there is no doubt before sending. */}
        <div className="mb-3 rounded-lg bg-surface-input px-3 py-2">
          <p className="text-[12px] font-semibold uppercase tracking-wide text-text-secondary">
            Forwarding
          </p>
          <p className="line-clamp-2 text-[13.5px] text-text-primary">
            {messagePreview(message)}
          </p>
        </div>

        <div className="relative mb-3">
          <Search
            size={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary"
          />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search chats"
            aria-label="Search chats to forward to"
            autoFocus
            className="w-full rounded-full bg-surface-input py-2 pl-9 pr-3 text-[14px] text-text-primary placeholder:text-text-secondary focus:outline-none focus:ring-2 focus:ring-signal-blue"
          />
        </div>

        {targets.length === 0 && (
          <p className="px-2 py-6 text-center text-[13px] text-text-secondary">
            No other chats to forward to.
          </p>
        )}

        {targets.map((conversation) => {
          const checked = selected.includes(conversation.id);
          return (
            <button
              key={conversation.id}
              type="button"
              onClick={() =>
                setSelected((current) =>
                  current.includes(conversation.id)
                    ? current.filter((id) => id !== conversation.id)
                    : [...current, conversation.id],
                )
              }
              aria-pressed={checked}
              className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-surface-hover"
            >
              <Avatar
                name={conversation.title}
                color={conversation.avatar_color}
                isGroup={conversation.type === "group"}
                online={
                  conversation.other_user
                    ? onlineUserIds.includes(conversation.other_user.id)
                    : false
                }
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14.5px] text-text-primary">
                  {conversation.title}
                </span>
                <span className="block truncate text-[12.5px] text-text-secondary">
                  {conversation.type === "group"
                    ? `${conversation.members.length} members`
                    : (conversation.other_user?.username ?? conversation.other_user?.phone ?? "")}
                </span>
              </span>
              <span
                className={clsx(
                  "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
                  checked
                    ? "border-signal-blue bg-signal-blue text-white"
                    : "border-[color:var(--divider)] text-transparent",
                )}
              >
                <Check size={14} />
              </span>
            </button>
          );
        })}
      </div>
    </Modal>
  );
}
