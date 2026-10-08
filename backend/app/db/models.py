"""Database schema.

    users ──┬── contacts (owner_id / contact_user_id, self-referential M2M)
            │
            ├── conversation_members ──── conversations
            │                                  │
            └── messages ──────────────────────┘
                   ├── message_receipts  (per-recipient delivered/read state)
                   └── message_reactions (per-user emoji)

A conversation is either a `direct` thread (exactly two members) or a `group`
(any number, with admin roles). Keeping both in one table means the inbox query,
the message pipeline and the websocket fan-out have a single code path.
"""

from __future__ import annotations

import enum
from datetime import datetime, timezone

from sqlalchemy import (
    Boolean,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class ConversationType(str, enum.Enum):
    direct = "direct"
    group = "group"


class MemberRole(str, enum.Enum):
    admin = "admin"
    member = "member"


class MessageKind(str, enum.Enum):
    text = "text"
    image = "image"
    file = "file"
    audio = "audio"  # voice notes recorded in the browser
    system = "system"  # "X created the group", "X added Y", ...


class MessageStatus(str, enum.Enum):
    """Aggregate status shown to the sender (the single/double check UI)."""

    sending = "sending"
    sent = "sent"
    delivered = "delivered"
    read = "read"


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    phone: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    username: Mapped[str | None] = mapped_column(String(64), unique=True, index=True)
    display_name: Mapped[str] = mapped_column(String(120))
    about: Mapped[str] = mapped_column(String(255), default="")
    # Signal renders initials on a coloured tile when there is no photo.
    avatar_color: Mapped[str] = mapped_column(String(16), default="blue")
    avatar_url: Mapped[str | None] = mapped_column(String(512), default=None)
    is_online: Mapped[bool] = mapped_column(Boolean, default=False)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    memberships: Mapped[list[ConversationMember]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    contacts: Mapped[list[Contact]] = relationship(
        back_populates="owner",
        foreign_keys="Contact.owner_id",
        cascade="all, delete-orphan",
    )


class Contact(Base):
    """One user's address-book entry pointing at another user."""

    __tablename__ = "contacts"
    __table_args__ = (UniqueConstraint("owner_id", "contact_user_id", name="uq_contact_pair"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    contact_user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    nickname: Mapped[str | None] = mapped_column(String(120), default=None)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    owner: Mapped[User] = relationship(back_populates="contacts", foreign_keys=[owner_id])
    contact_user: Mapped[User] = relationship(foreign_keys=[contact_user_id], lazy="joined")


class Conversation(Base):
    __tablename__ = "conversations"

    id: Mapped[int] = mapped_column(primary_key=True)
    type: Mapped[ConversationType] = mapped_column(
        Enum(ConversationType, native_enum=False), default=ConversationType.direct
    )
    # Groups only; direct threads take their title from the other member.
    name: Mapped[str | None] = mapped_column(String(120), default=None)
    description: Mapped[str | None] = mapped_column(String(500), default=None)
    avatar_color: Mapped[str] = mapped_column(String(16), default="teal")
    created_by_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), default=None
    )
    # 0 = off. Mirrors Signal's disappearing-messages timer.
    disappearing_seconds: Mapped[int] = mapped_column(Integer, default=0)
    # Denormalised so the inbox can be sorted without touching `messages`.
    last_message_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    members: Mapped[list[ConversationMember]] = relationship(
        back_populates="conversation", cascade="all, delete-orphan"
    )
    messages: Mapped[list[Message]] = relationship(
        back_populates="conversation", cascade="all, delete-orphan"
    )


class ConversationMember(Base):
    __tablename__ = "conversation_members"
    __table_args__ = (
        UniqueConstraint("conversation_id", "user_id", name="uq_conversation_member"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    conversation_id: Mapped[int] = mapped_column(
        ForeignKey("conversations.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    role: Mapped[MemberRole] = mapped_column(
        Enum(MemberRole, native_enum=False), default=MemberRole.member
    )
    # Everything after this timestamp counts as unread for this member.
    last_read_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    is_muted: Mapped[bool] = mapped_column(Boolean, default=False)
    is_pinned: Mapped[bool] = mapped_column(Boolean, default=False)
    joined_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    conversation: Mapped[Conversation] = relationship(back_populates="members")
    user: Mapped[User] = relationship(back_populates="memberships", lazy="joined")


class Message(Base):
    __tablename__ = "messages"
    __table_args__ = (
        Index("ix_messages_conversation_created", "conversation_id", "created_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    conversation_id: Mapped[int] = mapped_column(
        ForeignKey("conversations.id", ondelete="CASCADE"), index=True
    )
    # NULL for system messages.
    sender_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), default=None, index=True
    )
    kind: Mapped[MessageKind] = mapped_column(
        Enum(MessageKind, native_enum=False), default=MessageKind.text
    )
    body: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[MessageStatus] = mapped_column(
        Enum(MessageStatus, native_enum=False), default=MessageStatus.sent
    )
    reply_to_id: Mapped[int | None] = mapped_column(
        ForeignKey("messages.id", ondelete="SET NULL"), default=None
    )
    attachment_url: Mapped[str | None] = mapped_column(String(512), default=None)
    attachment_name: Mapped[str | None] = mapped_column(String(255), default=None)
    attachment_mime: Mapped[str | None] = mapped_column(String(120), default=None)
    attachment_size: Mapped[int | None] = mapped_column(Integer, default=None)
    # Voice notes only: the recorded length, so the player can draw its
    # duration without downloading and decoding the audio first.
    attachment_duration_ms: Mapped[int | None] = mapped_column(Integer, default=None)
    # Set once the sender edits the text; the UI shows an "edited" marker.
    edited_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)
    # Forwarded copies carry a label but are otherwise independent rows, so
    # deleting the original never blanks the copy.
    is_forwarded: Mapped[bool] = mapped_column(Boolean, default=False)
    # Set when the conversation has a disappearing timer configured.
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, index=True
    )

    conversation: Mapped[Conversation] = relationship(back_populates="messages")
    sender: Mapped[User | None] = relationship(lazy="joined")
    reply_to: Mapped[Message | None] = relationship(remote_side=[id], lazy="joined")
    receipts: Mapped[list[MessageReceipt]] = relationship(
        back_populates="message", cascade="all, delete-orphan", lazy="selectin"
    )
    reactions: Mapped[list[MessageReaction]] = relationship(
        back_populates="message", cascade="all, delete-orphan", lazy="selectin"
    )


class MessageReceipt(Base):
    """Per-recipient delivery state. The sender's aggregate `Message.status` is
    derived from these rows, which is what makes group read receipts work."""

    __tablename__ = "message_receipts"
    __table_args__ = (UniqueConstraint("message_id", "user_id", name="uq_receipt_per_user"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    message_id: Mapped[int] = mapped_column(
        ForeignKey("messages.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)

    message: Mapped[Message] = relationship(back_populates="receipts")


class MessageReaction(Base):
    __tablename__ = "message_reactions"
    __table_args__ = (
        UniqueConstraint("message_id", "user_id", "emoji", name="uq_reaction_per_user_emoji"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    message_id: Mapped[int] = mapped_column(
        ForeignKey("messages.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    emoji: Mapped[str] = mapped_column(String(16))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    message: Mapped[Message] = relationship(back_populates="reactions")
