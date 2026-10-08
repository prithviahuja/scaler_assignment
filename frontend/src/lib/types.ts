/** Mirrors the Pydantic schemas in `backend/app/schemas.py`. */

export type ConversationType = "direct" | "group";
export type MemberRole = "admin" | "member";
export type MessageKind = "text" | "image" | "file" | "audio" | "system";
export type MessageStatus = "sending" | "sent" | "delivered" | "read" | "failed";

export interface User {
  id: number;
  phone: string;
  username: string | null;
  display_name: string;
  about: string;
  avatar_color: string;
  avatar_url: string | null;
  is_online: boolean;
  last_seen_at: string;
}

export interface Contact {
  id: number;
  nickname: string | null;
  user: User;
}

export interface Member {
  user: User;
  role: MemberRole;
  joined_at: string;
}

export interface Reaction {
  emoji: string;
  user_ids: number[];
}

export interface MessageQuote {
  id: number;
  body: string;
  sender_id: number | null;
  sender_name: string | null;
  kind: MessageKind;
}

export interface Message {
  id: number;
  conversation_id: number;
  sender_id: number | null;
  sender_name: string | null;
  kind: MessageKind;
  body: string;
  status: MessageStatus;
  created_at: string;
  expires_at: string | null;
  deleted_at: string | null;
  attachment_url: string | null;
  attachment_name: string | null;
  attachment_mime: string | null;
  attachment_size: number | null;
  attachment_duration_ms: number | null;
  edited_at: string | null;
  is_forwarded: boolean;
  reply_to: MessageQuote | null;
  reactions: Reaction[];
  read_by: number[];
  /** Present only on optimistic bubbles and on the echo that reconciles them. */
  client_id?: string;
}

export interface Conversation {
  id: number;
  type: ConversationType;
  title: string;
  description: string | null;
  avatar_color: string;
  avatar_url: string | null;
  disappearing_seconds: number;
  last_message_at: string;
  unread_count: number;
  my_last_read_at: string;
  is_muted: boolean;
  is_pinned: boolean;
  my_role: MemberRole;
  members: Member[];
  other_user: User | null;
  last_message: Message | null;
}

/** What `POST /uploads` returns, ready to attach to a message. */
export interface UploadedAttachment {
  url: string;
  name: string;
  mime: string;
  size: number;
  kind: "image" | "file" | "audio";
  /** Client-measured, only for voice notes. */
  duration_ms?: number;
}

export interface AuthResponse {
  access_token: string;
  token_type: string;
  user: User;
}

export interface StartVerificationResponse {
  phone: string;
  dev_code: string;
  registered: boolean;
}

export interface SearchResults {
  conversations: Conversation[];
  contacts: User[];
  messages: Message[];
}

/** Inbound websocket frames. */
export type ServerEvent =
  | { type: "ready"; payload: { user_id: number; online_user_ids: number[] } }
  | { type: "pong"; payload: Record<string, never> }
  | { type: "message:new"; payload: Message }
  | { type: "message:updated"; payload: Message }
  | {
      type: "message:status";
      payload: {
        id: number;
        conversation_id: number;
        status: MessageStatus;
        read_by: number[];
      };
    }
  | {
      type: "typing";
      payload: {
        conversation_id: number;
        user_id: number;
        display_name: string;
        is_typing: boolean;
      };
    }
  | { type: "presence"; payload: User & { is_online: boolean } }
  | { type: "conversation:new"; payload: Conversation }
  | { type: "conversation:update"; payload: Conversation }
  | { type: "conversation:removed"; payload: { conversation_id: number } };
