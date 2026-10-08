"""Pydantic request/response models — the public shape of the API."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.db.models import ConversationType, MemberRole, MessageKind, MessageStatus


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ---------------------------------------------------------------- auth / users


class StartVerificationRequest(BaseModel):
    phone: str = Field(min_length=4, max_length=32)


class StartVerificationResponse(BaseModel):
    phone: str
    # Returned only because verification is mocked; it lets the UI prefill.
    dev_code: str
    registered: bool


class RegisterRequest(BaseModel):
    phone: str = Field(min_length=4, max_length=32)
    code: str
    display_name: str = Field(min_length=1, max_length=120)
    username: str | None = Field(default=None, max_length=64)
    about: str = Field(default="", max_length=255)
    avatar_color: str = Field(default="blue", max_length=16)


class LoginRequest(BaseModel):
    phone: str
    code: str


class UserPublic(ORMModel):
    id: int
    phone: str
    username: str | None
    display_name: str
    about: str
    avatar_color: str
    avatar_url: str | None
    is_online: bool
    last_seen_at: datetime


class AuthResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserPublic


class UpdateProfileRequest(BaseModel):
    display_name: str | None = Field(default=None, min_length=1, max_length=120)
    about: str | None = Field(default=None, max_length=255)
    avatar_color: str | None = Field(default=None, max_length=16)
    avatar_url: str | None = None
    username: str | None = Field(default=None, max_length=64)


# -------------------------------------------------------------------- contacts


class ContactPublic(BaseModel):
    id: int
    nickname: str | None
    user: UserPublic


class AddContactRequest(BaseModel):
    """Look the person up by phone or username; nickname is optional."""

    phone: str | None = None
    username: str | None = None
    nickname: str | None = Field(default=None, max_length=120)


# --------------------------------------------------------------------- members


class MemberPublic(BaseModel):
    user: UserPublic
    role: MemberRole
    joined_at: datetime


# -------------------------------------------------------------------- messages


class ReactionPublic(BaseModel):
    emoji: str
    user_ids: list[int]


class MessageQuote(BaseModel):
    """Trimmed-down parent message for the reply preview inside a bubble."""

    id: int
    body: str
    sender_id: int | None
    sender_name: str | None
    kind: MessageKind


class MessagePublic(BaseModel):
    id: int
    conversation_id: int
    sender_id: int | None
    sender_name: str | None
    kind: MessageKind
    body: str
    status: MessageStatus
    created_at: datetime
    expires_at: datetime | None
    deleted_at: datetime | None
    attachment_url: str | None
    attachment_name: str | None
    attachment_mime: str | None
    attachment_size: int | None
    attachment_duration_ms: int | None
    edited_at: datetime | None
    is_forwarded: bool
    reply_to: MessageQuote | None
    reactions: list[ReactionPublic]
    read_by: list[int]


class SendMessageRequest(BaseModel):
    body: str = Field(default="", max_length=8000)
    kind: MessageKind = MessageKind.text
    reply_to_id: int | None = None
    attachment_url: str | None = None
    attachment_name: str | None = None
    attachment_mime: str | None = None
    attachment_size: int | None = Field(default=None, ge=0)
    attachment_duration_ms: int | None = Field(default=None, ge=0)
    # Echoed back on the broadcast so the sender can reconcile its optimistic bubble.
    client_id: str | None = Field(default=None, max_length=64)


class EditMessageRequest(BaseModel):
    body: str = Field(min_length=1, max_length=8000)


class ForwardMessageRequest(BaseModel):
    """Copy one message into one or more other conversations."""

    conversation_ids: list[int] = Field(min_length=1, max_length=20)


class UploadResponse(BaseModel):
    """Metadata for a stored file, fed straight into SendMessageRequest."""

    url: str
    name: str
    mime: str
    size: int
    kind: MessageKind


class ReactRequest(BaseModel):
    emoji: str = Field(min_length=1, max_length=16)


# --------------------------------------------------------------- conversations


class ConversationPublic(BaseModel):
    id: int
    type: ConversationType
    title: str
    description: str | None
    avatar_color: str
    avatar_url: str | None
    disappearing_seconds: int
    last_message_at: datetime
    unread_count: int
    # Where this member last left off; the client freezes it on open to draw
    # the "unread messages" divider before marking the thread read.
    my_last_read_at: datetime
    is_muted: bool
    is_pinned: bool
    my_role: MemberRole
    members: list[MemberPublic]
    # Direct conversations only — drives the online dot and "last seen" line.
    other_user: UserPublic | None
    last_message: MessagePublic | None


class CreateDirectRequest(BaseModel):
    user_id: int


class CreateGroupRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    member_ids: list[int] = Field(default_factory=list)
    description: str | None = Field(default=None, max_length=500)
    avatar_color: str = Field(default="teal", max_length=16)


class UpdateGroupRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=500)
    avatar_color: str | None = Field(default=None, max_length=16)
    disappearing_seconds: int | None = Field(default=None, ge=0)


class AddMembersRequest(BaseModel):
    user_ids: list[int]


class ConversationSettingsRequest(BaseModel):
    is_muted: bool | None = None
    is_pinned: bool | None = None


class SearchResults(BaseModel):
    conversations: list[ConversationPublic]
    contacts: list[UserPublic]
    messages: list[MessagePublic]
