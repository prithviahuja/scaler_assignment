"""Converters from ORM rows to the API shapes in `app.schemas`.

`is_online` is intentionally *not* trusted from the database column — the
websocket hub is the source of truth for who is connected right now, and the
column is only the fallback for a process restart.
"""

from __future__ import annotations

from collections import defaultdict

from app.db.models import (
    Conversation,
    ConversationMember,
    ConversationType,
    Message,
    User,
)
from app.realtime.hub import hub
from app.schemas import (
    ContactPublic,
    ConversationPublic,
    MemberPublic,
    MessagePublic,
    MessageQuote,
    ReactionPublic,
    UserPublic,
)


def serialize_user(user: User) -> UserPublic:
    return UserPublic(
        id=user.id,
        phone=user.phone,
        username=user.username,
        display_name=user.display_name,
        about=user.about,
        avatar_color=user.avatar_color,
        avatar_url=user.avatar_url,
        is_online=hub.is_online(user.id) or user.is_online,
        last_seen_at=user.last_seen_at,
    )


def serialize_contact(contact) -> ContactPublic:
    return ContactPublic(
        id=contact.id,
        nickname=contact.nickname,
        user=serialize_user(contact.contact_user),
    )


def serialize_member(member: ConversationMember) -> MemberPublic:
    return MemberPublic(
        user=serialize_user(member.user),
        role=member.role,
        joined_at=member.joined_at,
    )


def serialize_message(message: Message) -> MessagePublic:
    grouped: dict[str, list[int]] = defaultdict(list)
    for reaction in message.reactions:
        grouped[reaction.emoji].append(reaction.user_id)

    quote: MessageQuote | None = None
    if message.reply_to is not None:
        parent = message.reply_to
        quote = MessageQuote(
            id=parent.id,
            body="" if parent.deleted_at else parent.body,
            sender_id=parent.sender_id,
            sender_name=parent.sender.display_name if parent.sender else None,
            kind=parent.kind,
        )

    return MessagePublic(
        id=message.id,
        conversation_id=message.conversation_id,
        sender_id=message.sender_id,
        sender_name=message.sender.display_name if message.sender else None,
        kind=message.kind,
        body="" if message.deleted_at else message.body,
        status=message.status,
        created_at=message.created_at,
        expires_at=message.expires_at,
        deleted_at=message.deleted_at,
        attachment_url=None if message.deleted_at else message.attachment_url,
        attachment_name=None if message.deleted_at else message.attachment_name,
        attachment_mime=message.attachment_mime,
        attachment_size=None if message.deleted_at else message.attachment_size,
        attachment_duration_ms=None if message.deleted_at else message.attachment_duration_ms,
        edited_at=message.edited_at,
        is_forwarded=message.is_forwarded,
        reply_to=quote,
        reactions=[ReactionPublic(emoji=k, user_ids=v) for k, v in grouped.items()],
        read_by=[r.user_id for r in message.receipts if r.read_at is not None],
    )


def conversation_title(conversation: Conversation, viewer_id: int) -> str:
    if conversation.type is ConversationType.group:
        return conversation.name or "New group"
    other = other_member(conversation, viewer_id)
    return other.user.display_name if other else "Note to self"


def other_member(conversation: Conversation, viewer_id: int) -> ConversationMember | None:
    """The counterpart in a direct thread (None for groups / notes to self)."""
    if conversation.type is not ConversationType.direct:
        return None
    for member in conversation.members:
        if member.user_id != viewer_id:
            return member
    return None


def serialize_conversation(
    conversation: Conversation,
    viewer_member: ConversationMember,
    unread_count: int = 0,
    last_message: Message | None = None,
) -> ConversationPublic:
    counterpart = other_member(conversation, viewer_member.user_id)
    avatar_color = (
        counterpart.user.avatar_color if counterpart else conversation.avatar_color
    )
    avatar_url = counterpart.user.avatar_url if counterpart else None

    return ConversationPublic(
        id=conversation.id,
        type=conversation.type,
        title=conversation_title(conversation, viewer_member.user_id),
        description=conversation.description,
        avatar_color=avatar_color,
        avatar_url=avatar_url,
        disappearing_seconds=conversation.disappearing_seconds,
        last_message_at=conversation.last_message_at,
        unread_count=unread_count,
        my_last_read_at=viewer_member.last_read_at,
        is_muted=viewer_member.is_muted,
        is_pinned=viewer_member.is_pinned,
        my_role=viewer_member.role,
        members=[serialize_member(m) for m in conversation.members],
        other_user=serialize_user(counterpart.user) if counterpart else None,
        last_message=serialize_message(last_message) if last_message else None,
    )
