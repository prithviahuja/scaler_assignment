"use client";

import { CircleDashed, Lock, MessageSquare, Phone } from "lucide-react";
import { useEffect, useState } from "react";
import clsx from "clsx";

import { ChatPane } from "@/components/ChatPane";
import { ComposeModal } from "@/components/ComposeModal";
import { ConversationInfoPanel } from "@/components/ConversationInfoPanel";
import { ConversationList } from "@/components/ConversationList";
import { NavRail, type NavTab } from "@/components/NavRail";
import { SettingsPane } from "@/components/SettingsPane";
import { ComingSoon } from "@/components/ui/ComingSoon";
import { useAppStore } from "@/store/useAppStore";

/**
 * Three-column desktop layout (rail · list · chat) that collapses to a single
 * column on phones, where the chat pane slides over the list.
 */
export function AppShell() {
  const me = useAppStore((state) => state.me);
  const conversations = useAppStore((state) => state.conversations);
  const activeId = useAppStore((state) => state.activeConversationId);
  const openConversation = useAppStore((state) => state.openConversation);
  const closeConversation = useAppStore((state) => state.closeConversation);
  const socketStatus = useAppStore((state) => state.socketStatus);
  const pushToast = useAppStore((state) => state.pushToast);
  const toggleTheme = useAppStore((state) => state.toggleTheme);

  const [tab, setTab] = useState<NavTab>("chats");
  const [composeOpen, setComposeOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);

  const active = conversations.find((item) => item.id === activeId) ?? null;
  const unreadTotal = conversations.reduce((sum, item) => sum + item.unread_count, 0);

  // Close the details drawer when switching threads.
  useEffect(() => {
    setInfoOpen(false);
  }, [activeId]);

  // Re-confirm read receipts when the window regains focus.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "visible" && activeId) void openConversation(activeId);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [activeId, openConversation]);

  // Keyboard shortcuts, matching Signal Desktop where they overlap.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey;
      if (mod && event.key.toLowerCase() === "n") {
        event.preventDefault();
        setTab("chats");
        setComposeOpen(true);
      } else if (mod && event.shiftKey && event.key.toLowerCase() === "d") {
        event.preventDefault();
        toggleTheme();
      } else if (mod && event.key === ",") {
        event.preventDefault();
        setTab("settings");
      } else if (event.key === "Escape") {
        if (composeOpen) setComposeOpen(false);
        else if (infoOpen) setInfoOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [composeOpen, infoOpen, toggleTheme]);

  if (!me) return null;

  const showChatOnMobile = Boolean(active);

  return (
    <div className="flex h-dvh overflow-hidden bg-surface">
      {/* On a phone the open chat takes the full width, so the rail steps
          aside; it is always present from `md` up. */}
      <div className={clsx(showChatOnMobile && tab === "chats" ? "hidden md:flex" : "flex")}>
        <NavRail
          active={tab}
          onChange={(next) => {
            setTab(next);
            if (next !== "chats") closeConversation();
          }}
          me={me}
          unreadTotal={unreadTotal}
          socketOffline={socketStatus !== "open"}
        />
      </div>

      {/* ------------------------------------------------------- middle pane */}
      <div
        className={clsx(
          "w-full shrink-0 md:w-80 lg:w-96",
          showChatOnMobile && tab === "chats" ? "hidden md:block" : "block",
        )}
        style={{ borderRight: "1px solid var(--divider)" }}
      >
        {tab === "chats" && <ConversationList onCompose={() => setComposeOpen(true)} />}
        {tab === "settings" && <SettingsPane />}
        {tab === "calls" && (
          <ComingSoon
            icon={Phone}
            title="Calls"
            description="Voice and video calling is not part of this build."
          />
        )}
        {tab === "stories" && (
          <ComingSoon
            icon={CircleDashed}
            title="Stories"
            description="Disappearing photo and video updates are not part of this build."
          />
        )}
      </div>

      {/* --------------------------------------------------------- chat pane */}
      <div
        className={clsx(
          "min-w-0 flex-1",
          tab === "chats" && showChatOnMobile ? "block" : "hidden md:block",
        )}
      >
        {tab === "chats" && active ? (
          <ChatPane
            conversation={active}
            onOpenInfo={() => setInfoOpen(true)}
            onBack={closeConversation}
            onComingSoon={(feature) =>
              pushToast({ title: `${feature} are coming soon`, tone: "default" })
            }
          />
        ) : (
          <EmptyChatState />
        )}
      </div>

      {/* --------------------------------------------------------- info pane */}
      {infoOpen && active && (
        <div className="fixed inset-0 z-40 md:static md:z-auto md:block">
          <ConversationInfoPanel conversation={active} onClose={() => setInfoOpen(false)} />
        </div>
      )}

      <ComposeModal
        open={composeOpen}
        onClose={() => setComposeOpen(false)}
        onOpened={(conversationId) => {
          setTab("chats");
          void openConversation(conversationId);
        }}
      />
    </div>
  );
}

function EmptyChatState() {
  return (
    <div className="flex h-full flex-col items-center justify-center px-8 text-center">
      <div className="mb-5 flex h-20 w-20 items-center justify-center rounded-full bg-surface-active">
        <MessageSquare size={32} className="text-text-secondary" />
      </div>
      <h2 className="text-[20px] font-semibold text-text-primary">Select a chat</h2>
      <p className="mt-2 max-w-sm text-[14px] leading-relaxed text-text-secondary">
        Pick a conversation from the list, or press{" "}
        <kbd className="rounded bg-surface-active px-1.5 py-0.5 text-[12px]">Ctrl</kbd>
        {" + "}
        <kbd className="rounded bg-surface-active px-1.5 py-0.5 text-[12px]">N</kbd> to start a
        new one.
      </p>
      <p className="mt-6 flex items-center gap-1.5 text-[12.5px] text-text-secondary">
        <Lock size={13} /> Encryption is simulated in this build.
      </p>
    </div>
  );
}
