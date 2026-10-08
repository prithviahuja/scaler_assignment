"use client";

import {
  BellOff,
  Bell,
  Crown,
  LogOut,
  Pin,
  PinOff,
  Timer,
  Trash2,
  UserPlus,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";

import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Modal";
import { api } from "@/lib/api";
import { formatPresence, formatTimer } from "@/lib/format";
import type { Conversation, Member, User } from "@/lib/types";
import { useAppStore } from "@/store/useAppStore";

const TIMER_OPTIONS = [0, 30, 300, 3600, 86400, 604800];

/** Right-hand drawer: profile for direct chats, admin controls for groups. */
export function ConversationInfoPanel({
  conversation,
  onClose,
}: {
  conversation: Conversation;
  onClose: () => void;
}) {
  const me = useAppStore((state) => state.me);
  const onlineUserIds = useAppStore((state) => state.onlineUserIds);
  const upsertConversation = useAppStore((state) => state.upsertConversation);
  const refreshConversations = useAppStore((state) => state.refreshConversations);
  const pushToast = useAppStore((state) => state.pushToast);

  const [members, setMembers] = useState<Member[]>(conversation.members);
  const [addingOpen, setAddingOpen] = useState(false);
  const [directory, setDirectory] = useState<User[]>([]);
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState(conversation.title);

  const isGroup = conversation.type === "group";
  const isAdmin = conversation.my_role === "admin";

  useEffect(() => {
    setMembers(conversation.members);
    setDraftName(conversation.title);
  }, [conversation]);

  useEffect(() => {
    if (!addingOpen) return;
    api
      .directory()
      .then((users) =>
        setDirectory(users.filter((user) => !members.some((m) => m.user.id === user.id))),
      )
      .catch(() => setDirectory([]));
  }, [addingOpen, members]);

  const guard = async (action: () => Promise<void>, failureTitle: string) => {
    try {
      await action();
    } catch (error) {
      pushToast({
        title: failureTitle,
        description: error instanceof Error ? error.message : undefined,
        tone: "error",
      });
    }
  };

  return (
    <aside
      className="flex h-full w-full flex-col bg-surface md:w-80 lg:w-96"
      style={{ borderLeft: "1px solid var(--divider)" }}
      aria-label="Conversation details"
    >
      <header
        className="flex shrink-0 items-center gap-3 px-4 py-3"
        style={{ borderBottom: "1px solid var(--divider)" }}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close details"
          className="-ml-2 rounded-full p-2 text-text-primary hover:bg-surface-hover"
        >
          <X size={18} />
        </button>
        <h2 className="text-[16px] font-semibold text-text-primary">
          {isGroup ? "Group info" : "Contact info"}
        </h2>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto scroll-thin">
        <div className="flex flex-col items-center px-5 py-6 text-center">
          <Avatar
            name={conversation.title}
            color={conversation.avatar_color}
            isGroup={isGroup}
            size="xxl"
          />
          {renaming ? (
            <div className="mt-4 flex w-full gap-2">
              <input
                value={draftName}
                onChange={(event) => setDraftName(event.target.value)}
                className="min-w-0 flex-1 rounded-lg bg-surface-input px-3 py-2 text-[14px] text-text-primary focus:outline-none focus:ring-2 focus:ring-signal-blue"
                aria-label="Group name"
              />
              <Button
                onClick={() =>
                  guard(async () => {
                    const updated = await api.updateGroup(conversation.id, {
                      name: draftName.trim(),
                    });
                    upsertConversation(updated);
                    setRenaming(false);
                  }, "Could not rename group")
                }
                className="px-4"
              >
                Save
              </Button>
            </div>
          ) : (
            <>
              <h3 className="mt-4 text-[20px] font-semibold text-text-primary">
                {conversation.title}
              </h3>
              {isGroup ? (
                <p className="mt-1 text-[13.5px] text-text-secondary">
                  {members.length} members
                  {conversation.description ? ` · ${conversation.description}` : ""}
                </p>
              ) : (
                conversation.other_user && (
                  <>
                    <p className="mt-1 text-[13.5px] text-text-secondary">
                      {formatPresence({
                        is_online: onlineUserIds.includes(conversation.other_user.id),
                        last_seen_at: conversation.other_user.last_seen_at,
                      })}
                    </p>
                    <p className="mt-2 text-[13.5px] text-text-secondary">
                      {conversation.other_user.phone}
                      {conversation.other_user.username
                        ? ` · @${conversation.other_user.username}`
                        : ""}
                    </p>
                    {conversation.other_user.about && (
                      <p className="mt-2 text-[13.5px] text-text-primary">
                        {conversation.other_user.about}
                      </p>
                    )}
                  </>
                )
              )}
              {isGroup && isAdmin && (
                <button
                  type="button"
                  onClick={() => setRenaming(true)}
                  className="mt-3 text-[13.5px] font-semibold text-signal-blue hover:underline"
                >
                  Edit group name
                </button>
              )}
            </>
          )}
        </div>

        {/* ------------------------------------------------- preferences */}
        <Section title="Preferences">
          <RowButton
            icon={conversation.is_muted ? <Bell size={17} /> : <BellOff size={17} />}
            label={conversation.is_muted ? "Unmute notifications" : "Mute notifications"}
            onClick={() =>
              guard(async () => {
                const updated = await api.updateMySettings(conversation.id, {
                  is_muted: !conversation.is_muted,
                });
                upsertConversation(updated);
              }, "Could not update notifications")
            }
          />
          <RowButton
            icon={conversation.is_pinned ? <PinOff size={17} /> : <Pin size={17} />}
            label={conversation.is_pinned ? "Unpin chat" : "Pin chat"}
            onClick={() =>
              guard(async () => {
                const updated = await api.updateMySettings(conversation.id, {
                  is_pinned: !conversation.is_pinned,
                });
                upsertConversation(updated);
              }, "Could not pin chat")
            }
          />
          {isGroup && isAdmin && (
            <div className="px-4 py-3">
              <div className="mb-2 flex items-center gap-2.5 text-[14px] text-text-primary">
                <Timer size={17} className="text-text-secondary" />
                Disappearing messages
              </div>
              <select
                value={conversation.disappearing_seconds}
                onChange={(event) =>
                  guard(async () => {
                    const updated = await api.updateGroup(conversation.id, {
                      disappearing_seconds: Number(event.target.value),
                    });
                    upsertConversation(updated);
                  }, "Could not update the timer")
                }
                className="w-full rounded-lg bg-surface-input px-3 py-2 text-[13.5px] text-text-primary focus:outline-none focus:ring-2 focus:ring-signal-blue"
                aria-label="Disappearing message timer"
              >
                {TIMER_OPTIONS.map((seconds) => (
                  <option key={seconds} value={seconds}>
                    {formatTimer(seconds)}
                  </option>
                ))}
              </select>
            </div>
          )}
        </Section>

        {/* ----------------------------------------------------- members */}
        {isGroup && (
          <Section title={`${members.length} members`}>
            {isAdmin && (
              <RowButton
                icon={<UserPlus size={17} />}
                label="Add members"
                onClick={() => setAddingOpen((open) => !open)}
                accent
              />
            )}

            {addingOpen && (
              <div className="mb-2 max-h-56 overflow-y-auto px-2 scroll-thin">
                {directory.length === 0 && (
                  <p className="px-2 py-3 text-[13px] text-text-secondary">
                    Everyone is already in this group.
                  </p>
                )}
                {directory.map((user) => (
                  <button
                    key={user.id}
                    type="button"
                    onClick={() =>
                      guard(async () => {
                        const updated = await api.addMembers(conversation.id, [user.id]);
                        setMembers(updated);
                        setAddingOpen(false);
                        await refreshConversations();
                        pushToast({ title: `${user.display_name} added`, tone: "default" });
                      }, "Could not add member")
                    }
                    className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-surface-hover"
                  >
                    <Avatar name={user.display_name} color={user.avatar_color} size="sm" />
                    <span className="truncate text-[14px] text-text-primary">
                      {user.display_name}
                    </span>
                  </button>
                ))}
              </div>
            )}

            {members.map((member) => {
              const isMe = member.user.id === me?.id;
              return (
                <div
                  key={member.user.id}
                  className="group flex items-center gap-3 px-4 py-2 hover:bg-surface-hover"
                >
                  <Avatar
                    name={member.user.display_name}
                    color={member.user.avatar_color}
                    online={onlineUserIds.includes(member.user.id)}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] text-text-primary">
                      {isMe ? "You" : member.user.display_name}
                    </p>
                    <p className="truncate text-[12.5px] text-text-secondary">
                      {member.role === "admin" ? "Admin" : member.user.phone}
                    </p>
                  </div>

                  {isAdmin && !isMe && (
                    <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                      {member.role !== "admin" && (
                        <button
                          type="button"
                          title="Make admin"
                          aria-label={`Make ${member.user.display_name} an admin`}
                          onClick={() =>
                            guard(async () => {
                              setMembers(
                                await api.promoteMember(conversation.id, member.user.id),
                              );
                              pushToast({
                                title: `${member.user.display_name} is now an admin`,
                                tone: "default",
                              });
                            }, "Could not promote member")
                          }
                          className="rounded-full p-1.5 text-text-secondary hover:bg-surface-active"
                        >
                          <Crown size={15} />
                        </button>
                      )}
                      <button
                        type="button"
                        title="Remove from group"
                        aria-label={`Remove ${member.user.display_name}`}
                        onClick={() =>
                          guard(async () => {
                            setMembers(await api.removeMember(conversation.id, member.user.id));
                            await refreshConversations();
                            pushToast({
                              title: `${member.user.display_name} removed`,
                              tone: "default",
                            });
                          }, "Could not remove member")
                        }
                        className="rounded-full p-1.5 text-[#CF163E] hover:bg-surface-active"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </Section>
        )}

        {isGroup && (
          <Section title="">
            <RowButton
              icon={<LogOut size={17} />}
              label="Leave group"
              danger
              onClick={() =>
                guard(async () => {
                  if (!me) return;
                  await api.removeMember(conversation.id, me.id);
                  onClose();
                  await refreshConversations();
                  pushToast({ title: "You left the group", tone: "default" });
                }, "Could not leave group")
              }
            />
          </Section>
        )}
      </div>
    </aside>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="py-2" style={{ borderTop: "1px solid var(--divider)" }}>
      {title && (
        <h3 className="px-4 pb-1 pt-2 text-[12px] font-semibold uppercase tracking-wide text-text-secondary">
          {title}
        </h3>
      )}
      {children}
    </section>
  );
}

function RowButton({
  icon,
  label,
  onClick,
  danger = false,
  accent = false,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
  accent?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2.5 px-4 py-3 text-left text-[14px] hover:bg-surface-hover"
      style={{
        color: danger ? "#CF163E" : accent ? "#2C6BED" : "var(--text-primary)",
      }}
    >
      <span className={danger || accent ? "" : "text-text-secondary"}>{icon}</span>
      {label}
    </button>
  );
}
