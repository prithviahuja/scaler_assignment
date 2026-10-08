/**
 * Thin fetch wrapper around the FastAPI backend.
 *
 * The bearer token lives in localStorage (set by the auth store) rather than
 * being threaded through every call site, so components can call `api.*`
 * directly.
 */

import type {
  AuthResponse,
  Contact,
  Conversation,
  Member,
  Message,
  MessageKind,
  SearchResults,
  StartVerificationResponse,
  UploadedAttachment,
  User,
} from "./types";

const RAW_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8000";
export const API_BASE = RAW_BASE.replace(/\/$/, "");
export const TOKEN_KEY = "signal-clone.token";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null): void {
  if (typeof window === "undefined") return;
  if (token) window.localStorage.setItem(TOKEN_KEY, token);
  else window.localStorage.removeItem(TOKEN_KEY);
}

/** Websocket URL for the current session, derived from the HTTP base. */
export function websocketUrl(token: string): string {
  const base = API_BASE.replace(/^http/, "ws");
  return `${base}/api/ws?token=${encodeURIComponent(token)}`;
}

/**
 * Attachments are stored by the backend and served from its own origin, so the
 * relative path it returns has to be resolved against the API base before it
 * can be used as an `<img src>` or a download link.
 */
export function assetUrl(path: string | null | undefined): string {
  if (!path) return "";
  if (/^https?:\/\//.test(path)) return path;
  return `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;
}

async function request<T>(
  path: string,
  init: RequestInit & { parse?: boolean } = {},
): Promise<T> {
  const { parse = true, ...rest } = init;
  const token = getToken();

  const response = await fetch(`${API_BASE}/api${path}`, {
    ...rest,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(rest.headers ?? {}),
    },
  });

  if (!response.ok) {
    let detail = response.statusText;
    try {
      const body = await response.json();
      // FastAPI returns either a string detail or a validation error array.
      if (typeof body.detail === "string") detail = body.detail;
      else if (Array.isArray(body.detail)) detail = body.detail[0]?.msg ?? detail;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(detail, response.status);
  }

  if (!parse || response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/**
 * Upload one attachment. This bypasses `request` because the body is
 * multipart — the browser has to set its own `Content-Type` boundary.
 */
async function uploadFile(file: File): Promise<UploadedAttachment> {
  const token = getToken();
  const form = new FormData();
  form.append("file", file);

  const response = await fetch(`${API_BASE}/api/uploads`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });

  if (!response.ok) {
    let detail = "Upload failed";
    try {
      const body = await response.json();
      if (typeof body.detail === "string") detail = body.detail;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(detail, response.status);
  }
  return (await response.json()) as UploadedAttachment;
}

export const api = {
  uploadFile,

  // ---------------------------------------------------------------- auth
  startVerification: (phone: string) =>
    request<StartVerificationResponse>("/auth/start", {
      method: "POST",
      body: JSON.stringify({ phone }),
    }),

  register: (input: {
    phone: string;
    code: string;
    display_name: string;
    username?: string | null;
    about?: string;
    avatar_color?: string;
  }) =>
    request<AuthResponse>("/auth/register", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  login: (phone: string, code: string) =>
    request<AuthResponse>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ phone, code }),
    }),

  me: () => request<User>("/auth/me"),

  updateProfile: (input: Partial<Pick<User, "display_name" | "about" | "avatar_color" | "username">>) =>
    request<User>("/auth/me", { method: "PATCH", body: JSON.stringify(input) }),

  logout: () => request<void>("/auth/logout", { method: "POST", parse: false }),

  // ------------------------------------------------------------ contacts
  contacts: () => request<Contact[]>("/contacts"),

  addContact: (input: { phone?: string; username?: string; nickname?: string }) =>
    request<Contact>("/contacts", { method: "POST", body: JSON.stringify(input) }),

  removeContact: (id: number) =>
    request<void>(`/contacts/${id}`, { method: "DELETE", parse: false }),

  directory: (q = "") =>
    request<User[]>(`/contacts/directory?q=${encodeURIComponent(q)}`),

  // ------------------------------------------------------- conversations
  conversations: () => request<Conversation[]>("/conversations"),

  conversation: (id: number) => request<Conversation>(`/conversations/${id}`),

  search: (q: string) =>
    request<SearchResults>(`/conversations/search?q=${encodeURIComponent(q)}`),

  createDirect: (userId: number) =>
    request<Conversation>("/conversations/direct", {
      method: "POST",
      body: JSON.stringify({ user_id: userId }),
    }),

  createGroup: (input: { name: string; member_ids: number[]; description?: string | null; avatar_color?: string }) =>
    request<Conversation>("/conversations/groups", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  updateGroup: (
    id: number,
    input: { name?: string; description?: string | null; avatar_color?: string; disappearing_seconds?: number },
  ) =>
    request<Conversation>(`/conversations/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),

  updateMySettings: (id: number, input: { is_muted?: boolean; is_pinned?: boolean }) =>
    request<Conversation>(`/conversations/${id}/settings`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),

  members: (id: number) => request<Member[]>(`/conversations/${id}/members`),

  addMembers: (id: number, userIds: number[]) =>
    request<Member[]>(`/conversations/${id}/members`, {
      method: "POST",
      body: JSON.stringify({ user_ids: userIds }),
    }),

  removeMember: (id: number, userId: number) =>
    request<Member[]>(`/conversations/${id}/members/${userId}`, { method: "DELETE" }),

  promoteMember: (id: number, userId: number) =>
    request<Member[]>(`/conversations/${id}/members/${userId}/promote`, { method: "POST" }),

  // ----------------------------------------------------------- messages
  messages: (conversationId: number, options: { limit?: number; beforeId?: number } = {}) => {
    const params = new URLSearchParams();
    if (options.limit) params.set("limit", String(options.limit));
    if (options.beforeId) params.set("before_id", String(options.beforeId));
    const query = params.toString();
    return request<Message[]>(
      `/conversations/${conversationId}/messages${query ? `?${query}` : ""}`,
    );
  },

  sendMessage: (
    conversationId: number,
    input: {
      body: string;
      kind?: MessageKind;
      reply_to_id?: number | null;
      attachment_url?: string | null;
      attachment_name?: string | null;
      attachment_mime?: string | null;
      attachment_size?: number | null;
      attachment_duration_ms?: number | null;
      client_id?: string;
    },
  ) =>
    request<Message>(`/conversations/${conversationId}/messages`, {
      method: "POST",
      body: JSON.stringify(input),
    }),

  editMessage: (conversationId: number, messageId: number, body: string) =>
    request<Message>(`/conversations/${conversationId}/messages/${messageId}`, {
      method: "PATCH",
      body: JSON.stringify({ body }),
    }),

  forwardMessage: (conversationId: number, messageId: number, targetIds: number[]) =>
    request<Message[]>(`/conversations/${conversationId}/messages/${messageId}/forward`, {
      method: "POST",
      body: JSON.stringify({ conversation_ids: targetIds }),
    }),

  markRead: (conversationId: number) =>
    request<void>(`/conversations/${conversationId}/messages/read`, {
      method: "POST",
      parse: false,
    }),

  react: (conversationId: number, messageId: number, emoji: string) =>
    request<Message>(`/conversations/${conversationId}/messages/${messageId}/reactions`, {
      method: "POST",
      body: JSON.stringify({ emoji }),
    }),

  deleteMessage: (conversationId: number, messageId: number) =>
    request<Message>(`/conversations/${conversationId}/messages/${messageId}`, {
      method: "DELETE",
    }),
};
