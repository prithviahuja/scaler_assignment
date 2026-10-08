"use client";

import { Check, Search, UserPlus, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";

import { Avatar } from "@/components/ui/Avatar";
import { Button, Modal, TextField } from "@/components/ui/Modal";
import { api } from "@/lib/api";
import { colorForSeed } from "@/lib/avatar";
import type { User } from "@/lib/types";
import { useAppStore } from "@/store/useAppStore";

type Step = "pick" | "group-details" | "add-contact";

/**
 * Signal's "New chat" flow: a people list that can either open a direct thread
 * or switch into multi-select to create a group.
 */
export function ComposeModal({
  open,
  onClose,
  onOpened,
}: {
  open: boolean;
  onClose: () => void;
  onOpened: (conversationId: number) => void;
}) {
  const upsertConversation = useAppStore((state) => state.upsertConversation);
  const onlineUserIds = useAppStore((state) => state.onlineUserIds);
  const pushToast = useAppStore((state) => state.pushToast);
  const refreshConversations = useAppStore((state) => state.refreshConversations);

  const [step, setStep] = useState<Step>("pick");
  const [people, setPeople] = useState<User[]>([]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<number[]>([]);
  const [groupName, setGroupName] = useState("");
  const [newContact, setNewContact] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setStep("pick");
    setQuery("");
    setSelected([]);
    setGroupName("");
    setNewContact("");
    api.directory().then(setPeople).catch(() => setPeople([]));
  }, [open]);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return people;
    return people.filter(
      (user) =>
        user.display_name.toLowerCase().includes(term) ||
        (user.username ?? "").toLowerCase().includes(term) ||
        user.phone.includes(term),
    );
  }, [people, query]);

  const groupMode = selected.length > 0;

  const fail = (error: unknown, title: string) =>
    pushToast({
      title,
      description: error instanceof Error ? error.message : undefined,
      tone: "error",
    });

  const openDirect = async (user: User) => {
    setBusy(true);
    try {
      const conversation = await api.createDirect(user.id);
      upsertConversation(conversation);
      onOpened(conversation.id);
      onClose();
    } catch (error) {
      fail(error, "Could not start that chat");
    } finally {
      setBusy(false);
    }
  };

  const createGroup = async () => {
    const name = groupName.trim();
    if (!name || selected.length === 0) return;
    setBusy(true);
    try {
      const conversation = await api.createGroup({
        name,
        member_ids: selected,
        avatar_color: colorForSeed(name),
      });
      upsertConversation(conversation);
      onOpened(conversation.id);
      pushToast({ title: `Group "${name}" created`, tone: "default" });
      onClose();
    } catch (error) {
      fail(error, "Could not create the group");
    } finally {
      setBusy(false);
    }
  };

  const addContact = async () => {
    const value = newContact.trim();
    if (!value) return;
    setBusy(true);
    try {
      const contact = await api.addContact(
        value.startsWith("@") || !/^[+\d]/.test(value)
          ? { username: value }
          : { phone: value },
      );
      setPeople((current) =>
        current.some((user) => user.id === contact.user.id)
          ? current
          : [contact.user, ...current],
      );
      pushToast({ title: `${contact.user.display_name} added to contacts`, tone: "default" });
      setNewContact("");
      setStep("pick");
      await refreshConversations();
    } catch (error) {
      fail(error, "Could not add that contact");
    } finally {
      setBusy(false);
    }
  };

  // ------------------------------------------------------- group details step
  if (step === "group-details") {
    return (
      <Modal
        open={open}
        title="New group"
        description={`${selected.length} member${selected.length === 1 ? "" : "s"} selected`}
        onClose={onClose}
        footer={
          <>
            <Button variant="secondary" onClick={() => setStep("pick")}>
              Back
            </Button>
            <Button onClick={createGroup} disabled={busy || !groupName.trim()}>
              {busy ? "Creating…" : "Create group"}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4 pb-2">
          <div className="flex justify-center py-2">
            <Avatar
              name={groupName || "New group"}
              color={colorForSeed(groupName || "group")}
              isGroup
              size="xxl"
            />
          </div>
          <TextField
            label="Group name"
            value={groupName}
            onChange={(event) => setGroupName(event.target.value)}
            placeholder="e.g. Weekend Plans"
            maxLength={120}
            autoFocus
          />
          <div>
            <span className="mb-2 block text-[12px] font-semibold uppercase tracking-wide text-text-secondary">
              Members
            </span>
            <div className="flex flex-wrap gap-2">
              {selected.map((id) => {
                const user = people.find((person) => person.id === id);
                if (!user) return null;
                return (
                  <span
                    key={id}
                    className="flex items-center gap-2 rounded-full bg-surface-input py-1 pl-1 pr-3"
                  >
                    <Avatar name={user.display_name} color={user.avatar_color} size="sm" />
                    <span className="text-[13px] text-text-primary">{user.display_name}</span>
                  </span>
                );
              })}
            </div>
          </div>
        </div>
      </Modal>
    );
  }

  // ---------------------------------------------------------- add contact step
  if (step === "add-contact") {
    return (
      <Modal
        open={open}
        title="Add contact"
        description="Find someone by phone number or username."
        onClose={onClose}
        width="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setStep("pick")}>
              Back
            </Button>
            <Button onClick={addContact} disabled={busy || !newContact.trim()}>
              {busy ? "Adding…" : "Add"}
            </Button>
          </>
        }
      >
        <div className="pb-2">
          <TextField
            label="Phone number or username"
            value={newContact}
            onChange={(event) => setNewContact(event.target.value)}
            placeholder="+15550100003 or @rohan"
            autoFocus
            onKeyDown={(event) => event.key === "Enter" && addContact()}
          />
        </div>
      </Modal>
    );
  }

  // -------------------------------------------------------------- picker step
  return (
    <Modal
      open={open}
      title="New chat"
      onClose={onClose}
      footer={
        groupMode ? (
          <>
            <Button variant="secondary" onClick={() => setSelected([])}>
              Clear
            </Button>
            <Button onClick={() => setStep("group-details")}>
              Next ({selected.length})
            </Button>
          </>
        ) : undefined
      }
    >
      <div className="pb-2">
        <div className="relative mb-3">
          <Search
            size={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary"
          />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by name, username or number"
            aria-label="Search people"
            autoFocus
            className="w-full rounded-full bg-surface-input py-2 pl-9 pr-3 text-[14px] text-text-primary placeholder:text-text-secondary focus:outline-none focus:ring-2 focus:ring-signal-blue"
          />
        </div>

        <div className="mb-2 flex flex-col">
          <ActionRow
            icon={<UserPlus size={17} />}
            label="Add contact"
            onClick={() => setStep("add-contact")}
          />
          <ActionRow
            icon={<Users size={17} />}
            label={groupMode ? "Continue to group details" : "New group — select people below"}
            onClick={() => groupMode && setStep("group-details")}
          />
        </div>

        {filtered.length === 0 && (
          <p className="px-2 py-6 text-center text-[13px] text-text-secondary">
            Nobody matches that. Try “Add contact”.
          </p>
        )}

        {filtered.map((user) => {
          const checked = selected.includes(user.id);
          return (
            <div key={user.id} className="flex items-center gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => (groupMode ? toggle(user.id) : openDirect(user))}
                className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-surface-hover disabled:opacity-60"
              >
                <Avatar
                  name={user.display_name}
                  color={user.avatar_color}
                  online={onlineUserIds.includes(user.id)}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14.5px] text-text-primary">{user.display_name}</p>
                  <p className="truncate text-[12.5px] text-text-secondary">
                    {user.username ? `@${user.username}` : user.phone}
                  </p>
                </div>
              </button>
              <button
                type="button"
                onClick={() => toggle(user.id)}
                aria-label={`${checked ? "Remove" : "Add"} ${user.display_name} ${checked ? "from" : "to"} group selection`}
                aria-pressed={checked}
                className={clsx(
                  "mr-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
                  checked
                    ? "border-signal-blue bg-signal-blue text-white"
                    : "border-[color:var(--divider)] text-transparent hover:border-signal-blue",
                )}
              >
                <Check size={14} />
              </button>
            </div>
          );
        })}
      </div>
    </Modal>
  );

  function toggle(userId: number) {
    setSelected((current) =>
      current.includes(userId)
        ? current.filter((id) => id !== userId)
        : [...current, userId],
    );
  }
}

function ActionRow({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-3 rounded-lg px-2 py-2.5 text-left hover:bg-surface-hover"
    >
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-signal-blue text-white">
        {icon}
      </span>
      <span className="text-[14.5px] font-medium text-text-primary">{label}</span>
    </button>
  );
}
