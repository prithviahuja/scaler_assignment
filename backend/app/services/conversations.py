"""Conversation queries and mutations shared by the REST routes and websocket."""

from __future__ import annotations

from fastapi import HTTPException, status
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import (
    Conversation,
    ConversationMember,
    ConversationType,
    MemberRole,
    Message,
    MessageKind,
    utcnow,
)
from app.services.loaders import CONVERSATION_LOADERS, MESSAGE_LOADERS


async def load_conversation(session: AsyncSession, conversation_id: int) -> Conversation | None:
    result = await session.execute(
        select(Conversation)
        .where(Conversation.id == conversation_id)
        .options(*CONVERSATION_LOADERS)
        # Callers reload right after adding/removing members, and the row is
        # still in the identity map with the old collection attached.
        .execution_options(populate_existing=True)
    )
    return result.scalar_one_or_none()


async def get_member(
    session: AsyncSession, conversation_id: int, user_id: int
) -> ConversationMember | None:
    result = await session.execute(
        select(ConversationMember).where(
            ConversationMember.conversation_id == conversation_id,
            ConversationMember.user_id == user_id,
        )
    )
    return result.scalar_one_or_none()


async def require_membership(
    session: AsyncSession, conversation_id: int, user_id: int
) -> tuple[Conversation, ConversationMember]:
    """Load a conversation the caller is allowed to see, or raise."""
    conversation = await load_conversation(session, conversation_id)
    if conversation is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Conversation not found")
    member = next((m for m in conversation.members if m.user_id == user_id), None)
    if member is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You are not in this conversation")
    return conversation, member


async def require_admin(
    session: AsyncSession, conversation_id: int, user_id: int
) -> tuple[Conversation, ConversationMember]:
    conversation, member = await require_membership(session, conversation_id, user_id)
    if conversation.type is not ConversationType.group:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Not a group conversation")
    if member.role is not MemberRole.admin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Admins only")
    return conversation, member


def member_ids(conversation: Conversation) -> list[int]:
    return [m.user_id for m in conversation.members]


async def unread_count(
    session: AsyncSession, conversation_id: int, member: ConversationMember
) -> int:
    result = await session.execute(
        select(func.count(Message.id)).where(
            Message.conversation_id == conversation_id,
            Message.sender_id != member.user_id,
            Message.deleted_at.is_(None),
            Message.created_at > member.last_read_at,
        )
    )
    return int(result.scalar() or 0)


async def last_message(session: AsyncSession, conversation_id: int) -> Message | None:
    result = await session.execute(
        select(Message)
        .where(Message.conversation_id == conversation_id)
        .options(*MESSAGE_LOADERS)
        .order_by(Message.created_at.desc(), Message.id.desc())
        .limit(1)
    )
    return result.scalars().first()


async def list_for_user(session: AsyncSession, user_id: int) -> list[Conversation]:
    """Every conversation the user belongs to, newest activity first."""
    result = await session.execute(
        select(Conversation)
        .join(ConversationMember, ConversationMember.conversation_id == Conversation.id)
        .where(ConversationMember.user_id == user_id)
        .order_by(Conversation.last_message_at.desc())
        .options(*CONVERSATION_LOADERS)
    )
    return list(result.scalars().unique())


async def find_direct_between(
    session: AsyncSession, user_a: int, user_b: int
) -> Conversation | None:
    """A direct thread is unique per pair, so reuse it instead of creating twins."""
    a = select(ConversationMember.conversation_id).where(ConversationMember.user_id == user_a)
    b = select(ConversationMember.conversation_id).where(ConversationMember.user_id == user_b)
    result = await session.execute(
        select(Conversation)
        .where(
            Conversation.type == ConversationType.direct,
            Conversation.id.in_(a),
            Conversation.id.in_(b),
        )
        .options(*CONVERSATION_LOADERS)
    )
    return result.scalars().unique().first()


async def create_direct(session: AsyncSession, user_a: int, user_b: int) -> Conversation:
    existing = await find_direct_between(session, user_a, user_b)
    if existing is not None:
        return existing

    conversation = Conversation(
        type=ConversationType.direct,
        created_by_id=user_a,
        last_message_at=utcnow(),
    )
    session.add(conversation)
    await session.flush()

    unique_ids = {user_a, user_b}
    for user_id in unique_ids:
        session.add(
            ConversationMember(
                conversation_id=conversation.id,
                user_id=user_id,
                role=MemberRole.member,
            )
        )
    await session.commit()
    refreshed = await load_conversation(session, conversation.id)
    assert refreshed is not None
    return refreshed


async def create_group(
    session: AsyncSession,
    creator_id: int,
    name: str,
    member_user_ids: list[int],
    description: str | None,
    avatar_color: str,
) -> Conversation:
    conversation = Conversation(
        type=ConversationType.group,
        name=name,
        description=description,
        avatar_color=avatar_color,
        created_by_id=creator_id,
        last_message_at=utcnow(),
    )
    session.add(conversation)
    await session.flush()

    session.add(
        ConversationMember(
            conversation_id=conversation.id,
            user_id=creator_id,
            role=MemberRole.admin,
        )
    )
    for user_id in {uid for uid in member_user_ids if uid != creator_id}:
        session.add(
            ConversationMember(
                conversation_id=conversation.id,
                user_id=user_id,
                role=MemberRole.member,
            )
        )

    session.add(
        Message(
            conversation_id=conversation.id,
            sender_id=None,
            kind=MessageKind.system,
            body=f"{name} was created",
        )
    )
    await session.commit()
    refreshed = await load_conversation(session, conversation.id)
    assert refreshed is not None
    return refreshed


async def search_users(
    session: AsyncSession, viewer_id: int, term: str, limit: int = 20
) -> list:
    """Directory search across display name, username and phone."""
    from app.db.models import User

    pattern = f"%{term.lower()}%"
    result = await session.execute(
        select(User)
        .where(
            User.id != viewer_id,
            or_(
                func.lower(User.display_name).like(pattern),
                func.lower(func.coalesce(User.username, "")).like(pattern),
                User.phone.like(pattern),
            ),
        )
        .order_by(User.display_name)
        .limit(limit)
    )
    return list(result.scalars())
