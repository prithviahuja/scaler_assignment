"""Message creation, receipts and the status machine behind the check marks.

Status lifecycle for an outgoing message:

    sending (client-side only, optimistic)
      -> sent       persisted, no recipient socket connected yet
      -> delivered  at least one recipient's socket acknowledged it
      -> read       *every* recipient has opened the conversation

The per-recipient truth lives in `message_receipts`; `Message.status` is the
aggregate the sender's bubble renders.
"""

from __future__ import annotations

from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import (
    Conversation,
    ConversationMember,
    Message,
    MessageKind,
    MessageReaction,
    MessageReceipt,
    MessageStatus,
    utcnow,
)
from app.realtime.hub import hub
from app.services import conversations as conversation_service
from app.services.loaders import MESSAGE_LOADERS
from app.services.serializers import serialize_message


async def load_message(session: AsyncSession, message_id: int) -> Message | None:
    result = await session.execute(
        select(Message)
        .where(Message.id == message_id)
        .options(*MESSAGE_LOADERS)
        # The row may already sit in the identity map with a stale collection
        # (reactions/receipts just changed), so force a refresh.
        .execution_options(populate_existing=True)
    )
    return result.scalars().unique().one_or_none()


async def list_history(
    session: AsyncSession,
    conversation_id: int,
    limit: int = 50,
    before_id: int | None = None,
) -> list[Message]:
    """A page of history, oldest-first for rendering. `before_id` pages upward."""
    query = (
        select(Message)
        .where(Message.conversation_id == conversation_id)
        .options(*MESSAGE_LOADERS)
        .order_by(Message.id.desc())
        .limit(limit)
    )
    if before_id is not None:
        query = query.where(Message.id < before_id)
    result = await session.execute(query)
    rows = list(result.scalars().unique())
    rows.reverse()
    return rows


async def purge_expired(session: AsyncSession, conversation_id: int) -> list[int]:
    """Hard-delete messages whose disappearing timer has elapsed."""
    now = utcnow()
    result = await session.execute(
        select(Message).where(
            Message.conversation_id == conversation_id,
            Message.expires_at.is_not(None),
            Message.expires_at <= now,
        )
    )
    expired = list(result.scalars())
    if not expired:
        return []
    ids = [m.id for m in expired]
    for message in expired:
        await session.delete(message)
    await session.commit()
    return ids


async def create_message(
    session: AsyncSession,
    conversation: Conversation,
    sender_id: int | None,
    body: str,
    kind: MessageKind = MessageKind.text,
    reply_to_id: int | None = None,
    attachment_url: str | None = None,
    attachment_name: str | None = None,
    attachment_mime: str | None = None,
    attachment_size: int | None = None,
    attachment_duration_ms: int | None = None,
    is_forwarded: bool = False,
) -> Message:
    now = utcnow()
    expires_at = (
        now + timedelta(seconds=conversation.disappearing_seconds)
        if conversation.disappearing_seconds
        else None
    )

    recipients = [m.user_id for m in conversation.members if m.user_id != sender_id]
    anyone_online = any(hub.is_online(uid) for uid in recipients)

    message = Message(
        conversation_id=conversation.id,
        sender_id=sender_id,
        kind=kind,
        body=body,
        reply_to_id=reply_to_id,
        attachment_url=attachment_url,
        attachment_name=attachment_name,
        attachment_mime=attachment_mime,
        attachment_size=attachment_size,
        attachment_duration_ms=attachment_duration_ms,
        is_forwarded=is_forwarded,
        expires_at=expires_at,
        created_at=now,
        status=MessageStatus.delivered if anyone_online else MessageStatus.sent,
    )
    session.add(message)
    await session.flush()

    for user_id in recipients:
        session.add(
            MessageReceipt(
                message_id=message.id,
                user_id=user_id,
                delivered_at=now if hub.is_online(user_id) else None,
            )
        )

    conversation.last_message_at = now
    await session.commit()

    loaded = await load_message(session, message.id)
    assert loaded is not None
    return loaded


async def broadcast_new_message(conversation: Conversation, message: Message, client_id: str | None = None) -> None:
    payload = serialize_message(message).model_dump(mode="json")
    if client_id:
        payload["client_id"] = client_id
    await hub.broadcast(
        conversation_service.member_ids(conversation),
        "message:new",
        payload,
    )


async def _recompute_status(session: AsyncSession, message: Message) -> MessageStatus:
    """Collapse the per-recipient receipts into the sender-facing status."""
    receipts = message.receipts
    if not receipts:
        return message.status
    if all(r.read_at is not None for r in receipts):
        new_status = MessageStatus.read
    elif any(r.delivered_at is not None for r in receipts):
        new_status = MessageStatus.delivered
    else:
        new_status = MessageStatus.sent
    if new_status != message.status:
        message.status = new_status
        await session.commit()
    return new_status


async def mark_delivered(session: AsyncSession, user_id: int, message_ids: list[int]) -> None:
    """Called when a recipient's socket confirms it received messages."""
    if not message_ids:
        return
    now = utcnow()
    result = await session.execute(
        select(MessageReceipt).where(
            MessageReceipt.user_id == user_id,
            MessageReceipt.message_id.in_(message_ids),
            MessageReceipt.delivered_at.is_(None),
        )
    )
    touched = list(result.scalars())
    if not touched:
        return
    for receipt in touched:
        receipt.delivered_at = now
    await session.commit()
    await _notify_senders(session, [r.message_id for r in touched])


async def mark_conversation_read(
    session: AsyncSession, conversation_id: int, user_id: int
) -> list[int]:
    """Mark everything addressed to `user_id` in this thread as read.

    Returns the ids whose aggregate status changed, so the caller can tell the
    senders to flip their single check to a double check.
    """
    now = utcnow()
    result = await session.execute(
        select(MessageReceipt)
        .join(Message, Message.id == MessageReceipt.message_id)
        .where(
            Message.conversation_id == conversation_id,
            MessageReceipt.user_id == user_id,
            MessageReceipt.read_at.is_(None),
        )
    )
    receipts = list(result.scalars())
    for receipt in receipts:
        receipt.delivered_at = receipt.delivered_at or now
        receipt.read_at = now

    member = await conversation_service.get_member(session, conversation_id, user_id)
    if member is not None:
        member.last_read_at = now
    await session.commit()

    message_ids = [r.message_id for r in receipts]
    await _notify_senders(session, message_ids)
    return message_ids


async def _notify_senders(session: AsyncSession, message_ids: list[int]) -> None:
    """Push `message:status` for each affected message to its conversation."""
    seen: set[int] = set()
    for message_id in message_ids:
        if message_id in seen:
            continue
        seen.add(message_id)
        message = await load_message(session, message_id)
        if message is None:
            continue
        await _recompute_status(session, message)
        conversation = await conversation_service.load_conversation(
            session, message.conversation_id
        )
        if conversation is None:
            continue
        await hub.broadcast(
            conversation_service.member_ids(conversation),
            "message:status",
            {
                "id": message.id,
                "conversation_id": message.conversation_id,
                "status": message.status.value,
                "read_by": [r.user_id for r in message.receipts if r.read_at is not None],
            },
        )


async def toggle_reaction(
    session: AsyncSession, message: Message, user_id: int, emoji: str
) -> Message:
    existing = next(
        (r for r in message.reactions if r.user_id == user_id and r.emoji == emoji), None
    )
    if existing is not None:
        await session.delete(existing)
    else:
        # Signal allows one reaction per person; replace any previous emoji.
        for reaction in [r for r in message.reactions if r.user_id == user_id]:
            await session.delete(reaction)
        session.add(MessageReaction(message_id=message.id, user_id=user_id, emoji=emoji))
    await session.commit()
    refreshed = await load_message(session, message.id)
    assert refreshed is not None
    return refreshed


async def edit_body(session: AsyncSession, message: Message, body: str) -> Message:
    """Replace the text of an existing message and stamp it as edited."""
    message.body = body
    message.edited_at = utcnow()
    await session.commit()
    refreshed = await load_message(session, message.id)
    assert refreshed is not None
    return refreshed


async def forward_message(
    session: AsyncSession,
    source: Message,
    target: Conversation,
    sender_id: int,
) -> Message:
    """Copy a message into another conversation.

    The copy is an independent row rather than a pointer, so deleting the
    original later cannot blank out what people already received. The reply
    context is deliberately dropped — it would reference a message the new
    audience cannot see.
    """
    return await create_message(
        session,
        target,
        sender_id=sender_id,
        body=source.body,
        kind=source.kind,
        attachment_url=source.attachment_url,
        attachment_name=source.attachment_name,
        attachment_mime=source.attachment_mime,
        attachment_size=source.attachment_size,
        attachment_duration_ms=source.attachment_duration_ms,
        is_forwarded=True,
    )


async def soft_delete(session: AsyncSession, message: Message) -> Message:
    message.deleted_at = utcnow()
    message.body = ""
    message.attachment_url = None
    message.attachment_name = None
    message.attachment_size = None
    message.attachment_duration_ms = None
    await session.commit()
    refreshed = await load_message(session, message.id)
    assert refreshed is not None
    return refreshed


async def member_rows(session: AsyncSession, conversation_id: int) -> list[ConversationMember]:
    result = await session.execute(
        select(ConversationMember).where(ConversationMember.conversation_id == conversation_id)
    )
    return list(result.scalars())
