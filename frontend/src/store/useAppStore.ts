"use client";

/**
 * Single zustand store for the whole app.
 *
 * Three responsibilities worth calling out:
 *  - Optimistic sends: a bubble appears immediately with a temporary negative
 *    id and a `client_id`; the websocket echo (or the REST response) replaces
 *    it by matching that `client_id`.
 *  - Receipts: opening a focused conversation pushes a `read` frame, which the
 *    backend turns into `message:status` events for the other side's bubbles.
 *  - Presence: the socket is authoritative; `online_user_ids` from the `ready`
 *    frame seeds it and `presence` events keep it current.
 */

import { create } from "zustand";

import { ApiError, api, getToken, setToken } from "@/lib/api";
import { messagePreview } from "@/lib/format";
import { SignalSocket, type SocketStatus } from "@/lib/socket";
import type {
  Conversation,
  Message,
  ServerEvent,
  UploadedAttachment,
  User,
} from "@/lib/types";

export type AuthStatus = "loading" | "anonymous" | "authenticated";
export type Theme = "light" | "dark";

export interface Toast {
  id: string;
  title: string;
  description?: string;
  tone: "default" | "error";
}

interface TypingEntry {
  displayName: string;
  at: number;
}

interface AppState {
  authStatus: AuthStatus;
  me: User | null;
  socketStatus: SocketStatus;

  conversations: Conversation[];
  messages: Record<number, Message[]>;
  loadedConversations: Record<number, boolean>;
  activeConversationId: number | null;

  typing: Record<number, Record<number, TypingEntry>>;
  onlineUserIds: number[];
  /**
   * Frozen at the moment a thread is opened, *before* it is marked read, so
   * the "unread messages" divider stays put while you read instead of jumping
   * to the bottom. Cleared when you leave and come back.
   */
  unreadBoundary: Record<number, string | null>;
  desktopNotifications: boolean;

  toasts: Toast[];
  theme: Theme;

  // ---- lifecycle
  bootstrap: () => Promise<void>;
  signIn: (token: string, user: User) => Promise<void>;
  signOut: () => Promise<void>;

  // ---- data
  refreshConversations: () => Promise<void>;
  openConversation: (conversationId: number) => Promise<void>;
  closeConversation: () => void;
  loadOlder: (conversationId: number) => Promise<void>;

  sendMessage: (input: {
    conversationId: number;
    body: string;
    replyToId?: number | null;
    attachment?: UploadedAttachment | null;
  }) => Promise<void>;
  retryMessage: (conversationId: number, clientId: string) => Promise<void>;
  editMessage: (conversationId: number, messageId: number, body: string) => Promise<void>;
  forwardMessage: (
    conversationId: number,
    messageId: number,
    targetIds: number[],
  ) => Promise<void>;
  reactToMessage: (conversationId: number, messageId: number, emoji: string) => Promise<void>;
  deleteMessage: (conversationId: number, messageId: number) => Promise<void>;

  upsertConversation: (conversation: Conversation) => void;
  setMe: (user: User) => void;
  notifyTyping: (conversationId: number) => void;

  // ---- ui
  pushToast: (toast: Omit<Toast, "id">) => void;
  dismissToast: (id: string) => void;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  enableDesktopNotifications: () => Promise<boolean>;
}

const THEME_KEY = "signal-clone.theme";
const NOTIFICATIONS_KEY = "signal-clone.notifications";
const TYPING_TTL_MS = 4000;
let socket: SignalSocket | null = null;
/**
 * Guards for history paging. The message list sits at scrollTop 0 when a short
 * thread opens, so `loadOlder` would otherwise fire repeatedly and prepend the
 * same page several times. `exhausted` stops us asking again once the top of
 * the thread has been reached.
 */
const loadingOlder = new Set<number>();
const exhausted = new Set<number>();
let typingSentAt = 0;
let typingStopTimer: ReturnType<typeof setTimeout> | null = null;

function sortConversations(list: Conversation[]): Conversation[] {
  return [...list].sort((a, b) => {
    if (a.is_pinned !== b.is_pinned) return a.is_pinned ? -1 : 1;
    return new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime();
  });
}

function applyTheme(theme: Theme): void {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("dark", theme === "dark");
}

/**
 * Raise a real OS notification for a message that arrived while the user was
 * somewhere else. Clicking it focuses the tab. Guarded everywhere because
 * permission can be revoked at any time.
 */
function showDesktopNotification(title: string, body: string): void {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission !== "granted") return;
  try {
    const notification = new Notification(title, {
      body,
      icon: "/icon.svg",
      tag: "signal-clone-message",
    });
    notification.onclick = () => {
      window.focus();
      notification.close();
    };
  } catch {
    /* some browsers require a service worker; the in-app toast still fires */
  }
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

export const useAppStore = create<AppState>((set, get) => {
  /** Merge a server message into a conversation's list, de-duplicating. */
  function mergeMessage(conversationId: number, incoming: Message): void {
    set((state) => {
      const existing = state.messages[conversationId] ?? [];
      let replaced = false;

      const next = existing.map((message) => {
        const matchesClient =
          incoming.client_id !== undefined && message.client_id === incoming.client_id;
        if (matchesClient || message.id === incoming.id) {
          replaced = true;
          return { ...incoming, client_id: message.client_id };
        }
        return message;
      });

      if (!replaced) next.push(incoming);
      next.sort((a, b) => {
        const byTime =
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
        return byTime !== 0 ? byTime : a.id - b.id;
      });
      return { messages: { ...state.messages, [conversationId]: next } };
    });
  }

  /** Keep the conversation row's preview and ordering in step with a message. */
  function touchConversation(message: Message): void {
    const state = get();
    const isActive = state.activeConversationId === message.conversation_id;
    const fromMe = message.sender_id === state.me?.id;

    set((current) => ({
      conversations: sortConversations(
        current.conversations.map((conversation) => {
          if (conversation.id !== message.conversation_id) return conversation;
          const bumpUnread = !isActive && !fromMe && message.kind !== "system";
          return {
            ...conversation,
            last_message: message,
            last_message_at: message.created_at,
            unread_count: bumpUnread
              ? conversation.unread_count + 1
              : isActive
                ? 0
                : conversation.unread_count,
          };
        }),
      ),
    }));
  }

  /**
   * Refresh the chat-list preview after an in-place change (edit, delete,
   * reaction) — without touching unread counts or ordering, which only a new
   * message should affect.
   */
  function refreshPreview(message: Message): void {
    set((state) => ({
      conversations: state.conversations.map((conversation) =>
        conversation.id === message.conversation_id &&
        conversation.last_message?.id === message.id
          ? { ...conversation, last_message: message }
          : conversation,
      ),
    }));
  }

  function handleEvent(event: ServerEvent): void {
    switch (event.type) {
      case "ready": {
        set({ onlineUserIds: event.payload.online_user_ids });
        break;
      }

      case "message:new": {
        const message = event.payload;
        mergeMessage(message.conversation_id, message);
        touchConversation(message);

        const state = get();
        const fromMe = message.sender_id === state.me?.id;
        if (!fromMe) {
          // Confirm delivery, and read too when the thread is open and focused.
          socket?.sendDelivered([message.id]);
          if (
            state.activeConversationId === message.conversation_id &&
            typeof document !== "undefined" &&
            document.visibilityState === "visible"
          ) {
            socket?.sendRead(message.conversation_id);
          } else {
            const conversation = state.conversations.find(
              (item) => item.id === message.conversation_id,
            );
            if (conversation && !conversation.is_muted && message.kind !== "system") {
              const title =
                conversation.type === "group"
                  ? conversation.title
                  : (message.sender_name ?? "New message");
              const preview = messagePreview(message).slice(0, 120);
              get().pushToast({ title, description: preview, tone: "default" });

              // Only when the tab is actually in the background — an in-app
              // toast is enough while the user is looking at the window.
              if (
                state.desktopNotifications &&
                typeof document !== "undefined" &&
                document.visibilityState !== "visible"
              ) {
                showDesktopNotification(
                  conversation.type === "group"
                    ? `${message.sender_name ?? "Someone"} · ${conversation.title}`
                    : title,
                  preview,
                );
              }
            }
          }
        }
        // A typing indicator is implicitly cleared by the message arriving.
        set((current) => {
          const forConversation = { ...(current.typing[message.conversation_id] ?? {}) };
          if (message.sender_id !== null) delete forConversation[message.sender_id];
          return {
            typing: { ...current.typing, [message.conversation_id]: forConversation },
          };
        });
        break;
      }

      case "message:updated": {
        const updated = event.payload;
        mergeMessage(updated.conversation_id, updated);
        refreshPreview(updated);
        break;
      }

      case "message:status": {
        const { id, conversation_id, status, read_by } = event.payload;
        set((state) => ({
          messages: {
            ...state.messages,
            [conversation_id]: (state.messages[conversation_id] ?? []).map((message) =>
              message.id === id ? { ...message, status, read_by } : message,
            ),
          },
        }));
        break;
      }

      case "typing": {
        const { conversation_id, user_id, display_name, is_typing } = event.payload;
        set((state) => {
          const forConversation = { ...(state.typing[conversation_id] ?? {}) };
          if (is_typing) forConversation[user_id] = { displayName: display_name, at: Date.now() };
          else delete forConversation[user_id];
          return { typing: { ...state.typing, [conversation_id]: forConversation } };
        });
        break;
      }

      case "presence": {
        const { id, is_online } = event.payload;
        set((state) => ({
          onlineUserIds: is_online
            ? Array.from(new Set([...state.onlineUserIds, id]))
            : state.onlineUserIds.filter((userId) => userId !== id),
          conversations: state.conversations.map((conversation) =>
            conversation.other_user?.id === id
              ? {
                  ...conversation,
                  other_user: { ...conversation.other_user, ...event.payload },
                }
              : conversation,
          ),
        }));
        break;
      }

      case "conversation:new":
      case "conversation:update": {
        get().upsertConversation(event.payload);
        break;
      }

      case "conversation:removed": {
        const { conversation_id } = event.payload;
        set((state) => ({
          conversations: state.conversations.filter((item) => item.id !== conversation_id),
          activeConversationId:
            state.activeConversationId === conversation_id ? null : state.activeConversationId,
        }));
        get().pushToast({ title: "You were removed from a group", tone: "default" });
        break;
      }

      default:
        break;
    }
  }

  function startSocket(token: string): void {
    socket?.disconnect();
    socket = new SignalSocket(handleEvent, (status) => set({ socketStatus: status }));
    socket.connect(token);
  }

  // Typing entries expire on their own so a dropped "stopped typing" frame
  // cannot leave the indicator stuck on.
  if (typeof window !== "undefined") {
    setInterval(() => {
      const { typing } = get();
      const now = Date.now();
      let changed = false;
      const next: typeof typing = {};
      for (const [conversationId, entries] of Object.entries(typing)) {
        const kept: Record<number, TypingEntry> = {};
        for (const [userId, entry] of Object.entries(entries)) {
          if (now - entry.at < TYPING_TTL_MS) kept[Number(userId)] = entry;
          else changed = true;
        }
        next[Number(conversationId)] = kept;
      }
      if (changed) set({ typing: next });
    }, 1500);
  }

  return {
    authStatus: "loading",
    me: null,
    socketStatus: "closed",

    conversations: [],
    messages: {},
    loadedConversations: {},
    activeConversationId: null,

    typing: {},
    onlineUserIds: [],
    unreadBoundary: {},
    desktopNotifications: false,

    toasts: [],
    theme: "light",

    // ------------------------------------------------------------ lifecycle
    bootstrap: async () => {
      const stored =
        typeof window !== "undefined"
          ? (window.localStorage.getItem(THEME_KEY) as Theme | null)
          : null;
      const theme: Theme =
        stored ??
        (typeof window !== "undefined" &&
        window.matchMedia?.("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light");
      applyTheme(theme);

      const notificationsAllowed =
        typeof window !== "undefined" &&
        "Notification" in window &&
        Notification.permission === "granted" &&
        window.localStorage.getItem(NOTIFICATIONS_KEY) !== "off";
      set({ theme, desktopNotifications: notificationsAllowed });

      const token = getToken();
      if (!token) {
        set({ authStatus: "anonymous" });
        return;
      }

      try {
        const me = await api.me();
        set({ me, authStatus: "authenticated" });
        startSocket(token);
        await get().refreshConversations();
      } catch {
        setToken(null);
        set({ authStatus: "anonymous", me: null });
      }
    },

    signIn: async (token, user) => {
      setToken(token);
      set({ me: user, authStatus: "authenticated" });
      startSocket(token);
      await get().refreshConversations();
    },

    signOut: async () => {
      try {
        await api.logout();
      } catch {
        /* the token is being discarded anyway */
      }
      socket?.disconnect();
      socket = null;
      loadingOlder.clear();
      exhausted.clear();
      setToken(null);
      set({
        authStatus: "anonymous",
        me: null,
        conversations: [],
        messages: {},
        loadedConversations: {},
        activeConversationId: null,
        typing: {},
        onlineUserIds: [],
        unreadBoundary: {},
      });
    },

    // ----------------------------------------------------------------- data
    refreshConversations: async () => {
      try {
        const conversations = await api.conversations();
        set({ conversations: sortConversations(conversations) });
      } catch (error) {
        get().pushToast({
          title: "Could not load chats",
          description: errorMessage(error, "Check that the backend is running."),
          tone: "error",
        });
      }
    },

    openConversation: async (conversationId) => {
      const previouslyActive = get().activeConversationId;
      const conversation = get().conversations.find((item) => item.id === conversationId);

      set({ activeConversationId: conversationId });

      // Freeze where the unread run begins before the badge is cleared. Only
      // recompute when arriving from elsewhere, so the divider does not move
      // while the thread is open (e.g. on a window-focus refresh).
      if (previouslyActive !== conversationId) {
        set((state) => ({
          unreadBoundary: {
            ...state.unreadBoundary,
            [conversationId]:
              conversation && conversation.unread_count > 0
                ? conversation.my_last_read_at
                : null,
          },
        }));
      }

      // Clear the badge straight away, then confirm with the server.
      set((state) => ({
        conversations: state.conversations.map((item) =>
          item.id === conversationId ? { ...item, unread_count: 0 } : item,
        ),
      }));

      if (!get().loadedConversations[conversationId]) {
        try {
          const history = await api.messages(conversationId, { limit: 60 });
          exhausted.delete(conversationId);
          set((state) => ({
            messages: { ...state.messages, [conversationId]: history },
            loadedConversations: { ...state.loadedConversations, [conversationId]: true },
          }));
        } catch (error) {
          get().pushToast({
            title: "Could not load messages",
            description: errorMessage(error, "Please try again."),
            tone: "error",
          });
          return;
        }
      }

      socket?.sendRead(conversationId);
      try {
        await api.markRead(conversationId);
      } catch {
        /* the socket frame is the primary path */
      }
    },

    closeConversation: () => set({ activeConversationId: null }),

    loadOlder: async (conversationId) => {
      if (loadingOlder.has(conversationId) || exhausted.has(conversationId)) return;

      const current = get().messages[conversationId] ?? [];
      const oldest = current.find((message) => message.id > 0);
      if (!oldest) return;

      loadingOlder.add(conversationId);
      try {
        const older = await api.messages(conversationId, { limit: 40, beforeId: oldest.id });
        if (!older.length) {
          exhausted.add(conversationId);
          return;
        }
        set((state) => {
          const existing = state.messages[conversationId] ?? [];
          const seen = new Set(existing.map((message) => message.id));
          const fresh = older.filter((message) => !seen.has(message.id));
          if (!fresh.length) return {};
          return {
            messages: { ...state.messages, [conversationId]: [...fresh, ...existing] },
          };
        });
      } catch {
        /* silent: scrolling further up just stops */
      } finally {
        loadingOlder.delete(conversationId);
      }
    },

    sendMessage: async ({ conversationId, body, replyToId, attachment }) => {
      const me = get().me;
      const trimmed = body.trim();
      // An attachment alone is a valid message; a caption is optional.
      if (!me || (!trimmed && !attachment)) return;

      const clientId = `c-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const optimistic: Message = {
        id: -Date.now(),
        conversation_id: conversationId,
        sender_id: me.id,
        sender_name: me.display_name,
        kind: attachment?.kind ?? "text",
        body: trimmed,
        status: "sending",
        created_at: new Date().toISOString(),
        expires_at: null,
        deleted_at: null,
        // The file is already stored by the time we get here, so the optimistic
        // bubble can point at its real URL and render immediately.
        attachment_url: attachment?.url ?? null,
        attachment_name: attachment?.name ?? null,
        attachment_mime: attachment?.mime ?? null,
        attachment_size: attachment?.size ?? null,
        attachment_duration_ms: attachment?.duration_ms ?? null,
        edited_at: null,
        is_forwarded: false,
        reply_to: null,
        reactions: [],
        read_by: [],
        client_id: clientId,
      };

      if (replyToId) {
        const parent = (get().messages[conversationId] ?? []).find(
          (message) => message.id === replyToId,
        );
        if (parent) {
          optimistic.reply_to = {
            id: parent.id,
            body: parent.body,
            sender_id: parent.sender_id,
            sender_name: parent.sender_name,
            kind: parent.kind,
          };
        }
      }

      mergeMessage(conversationId, optimistic);
      touchConversation(optimistic);

      try {
        const saved = await api.sendMessage(conversationId, {
          body: trimmed,
          kind: attachment?.kind ?? "text",
          reply_to_id: replyToId ?? null,
          attachment_url: attachment?.url ?? null,
          attachment_name: attachment?.name ?? null,
          attachment_mime: attachment?.mime ?? null,
          attachment_size: attachment?.size ?? null,
          attachment_duration_ms: attachment?.duration_ms ?? null,
          client_id: clientId,
        });
        mergeMessage(conversationId, { ...saved, client_id: clientId });
        touchConversation(saved);
      } catch (error) {
        set((state) => ({
          messages: {
            ...state.messages,
            [conversationId]: (state.messages[conversationId] ?? []).map((message) =>
              message.client_id === clientId
                ? { ...message, status: "failed" as const }
                : message,
            ),
          },
        }));
        get().pushToast({
          title: "Message not sent",
          description: errorMessage(error, "Tap the bubble to retry."),
          tone: "error",
        });
      }
    },

    retryMessage: async (conversationId, clientId) => {
      const failed = (get().messages[conversationId] ?? []).find(
        (message) => message.client_id === clientId,
      );
      if (!failed) return;
      set((state) => ({
        messages: {
          ...state.messages,
          [conversationId]: (state.messages[conversationId] ?? []).filter(
            (message) => message.client_id !== clientId,
          ),
        },
      }));
      await get().sendMessage({
        conversationId,
        body: failed.body,
        replyToId: failed.reply_to?.id ?? null,
        attachment: failed.attachment_url
          ? {
              url: failed.attachment_url,
              name: failed.attachment_name ?? "attachment",
              mime: failed.attachment_mime ?? "application/octet-stream",
              size: failed.attachment_size ?? 0,
              kind:
                failed.kind === "image"
                  ? "image"
                  : failed.kind === "audio"
                    ? "audio"
                    : "file",
              duration_ms: failed.attachment_duration_ms ?? undefined,
            }
          : null,
      });
    },

    editMessage: async (conversationId, messageId, body) => {
      const trimmed = body.trim();
      if (!trimmed) return;
      try {
        const updated = await api.editMessage(conversationId, messageId, trimmed);
        mergeMessage(conversationId, updated);
        refreshPreview(updated);
      } catch (error) {
        get().pushToast({
          title: "Could not edit message",
          description: errorMessage(error, "Please try again."),
          tone: "error",
        });
      }
    },

    forwardMessage: async (conversationId, messageId, targetIds) => {
      if (!targetIds.length) return;
      try {
        const copies = await api.forwardMessage(conversationId, messageId, targetIds);
        // The sender's own sockets also receive these, but merging here means
        // the thread is already correct if you switch to it immediately.
        for (const copy of copies) {
          mergeMessage(copy.conversation_id, copy);
          touchConversation(copy);
        }
        get().pushToast({
          title: `Forwarded to ${copies.length} chat${copies.length === 1 ? "" : "s"}`,
          tone: "default",
        });
      } catch (error) {
        get().pushToast({
          title: "Could not forward message",
          description: errorMessage(error, "Please try again."),
          tone: "error",
        });
      }
    },

    reactToMessage: async (conversationId, messageId, emoji) => {
      try {
        const updated = await api.react(conversationId, messageId, emoji);
        mergeMessage(conversationId, updated);
      } catch (error) {
        get().pushToast({
          title: "Could not add reaction",
          description: errorMessage(error, "Please try again."),
          tone: "error",
        });
      }
    },

    deleteMessage: async (conversationId, messageId) => {
      try {
        const updated = await api.deleteMessage(conversationId, messageId);
        mergeMessage(conversationId, updated);
        refreshPreview(updated);
        get().pushToast({ title: "Message deleted for everyone", tone: "default" });
      } catch (error) {
        get().pushToast({
          title: "Could not delete message",
          description: errorMessage(error, "Please try again."),
          tone: "error",
        });
      }
    },

    upsertConversation: (conversation) => {
      set((state) => {
        const exists = state.conversations.some((item) => item.id === conversation.id);
        const conversations = exists
          ? state.conversations.map((item) =>
              item.id === conversation.id ? conversation : item,
            )
          : [conversation, ...state.conversations];
        return { conversations: sortConversations(conversations) };
      });
    },

    setMe: (user) => set({ me: user }),

    notifyTyping: (conversationId) => {
      const now = Date.now();
      // Throttle: one "started typing" frame per 2s, plus a trailing "stopped".
      if (now - typingSentAt > 2000) {
        socket?.sendTyping(conversationId, true);
        typingSentAt = now;
      }
      if (typingStopTimer) clearTimeout(typingStopTimer);
      typingStopTimer = setTimeout(() => {
        socket?.sendTyping(conversationId, false);
        typingSentAt = 0;
      }, 2500);
    },

    // ------------------------------------------------------------------- ui
    pushToast: (toast) => {
      const id = `t-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      set((state) => ({ toasts: [...state.toasts, { ...toast, id }] }));
      setTimeout(() => get().dismissToast(id), 4200);
    },

    dismissToast: (id) =>
      set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),

    setTheme: (theme) => {
      applyTheme(theme);
      if (typeof window !== "undefined") window.localStorage.setItem(THEME_KEY, theme);
      set({ theme });
    },

    toggleTheme: () => get().setTheme(get().theme === "dark" ? "light" : "dark"),

    enableDesktopNotifications: async () => {
      if (typeof window === "undefined" || !("Notification" in window)) {
        get().pushToast({
          title: "This browser does not support notifications",
          tone: "error",
        });
        return false;
      }
      const permission =
        Notification.permission === "granted"
          ? "granted"
          : await Notification.requestPermission();
      const granted = permission === "granted";
      set({ desktopNotifications: granted });
      if (typeof window !== "undefined") {
        window.localStorage.setItem(NOTIFICATIONS_KEY, granted ? "on" : "off");
      }
      if (!granted) {
        get().pushToast({
          title: "Notifications are blocked",
          description: "Allow them in your browser's site settings to get alerts.",
          tone: "error",
        });
      }
      return granted;
    },
  };
});

/** Selector helpers used by components. */
export const selectActiveConversation = (state: AppState): Conversation | null =>
  state.conversations.find((item) => item.id === state.activeConversationId) ?? null;

export const selectActiveMessages = (state: AppState): Message[] =>
  state.activeConversationId ? (state.messages[state.activeConversationId] ?? []) : [];
