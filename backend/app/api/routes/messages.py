"""Message history, sending, receipts, reactions and deletion.

Sending over REST (rather than only over the socket) keeps the write path
testable with curl and gives the client a real HTTP error to show when a send
fails. The resulting broadcast still goes out over the websocket.
"""

from fastapi import APIRouter, HTTPException, Query, status

from app.api.deps import CurrentUser, SessionDep
from app.db.models import MessageKind
from app.realtime.hub import hub
from app.schemas import (
    EditMessageRequest,
    ForwardMessageRequest,
    MessagePublic,
    ReactRequest,
    SendMessageRequest,
)
from app.services import conversations as conversation_service
from app.services import messages as message_service
from app.services.serializers import serialize_message

router = APIRouter(prefix="/conversations/{conversation_id}/messages", tags=["messages"])


@router.get("", response_model=list[MessagePublic])
async def list_messages(
    conversation_id: int,
    current_user: CurrentUser,
    session: SessionDep,
    limit: int = Query(default=50, ge=1, le=200),
    before_id: int | None = Query(default=None),
):
    await conversation_service.require_membership(session, conversation_id, current_user.id)
    await message_service.purge_expired(session, conversation_id)
    history = await message_service.list_history(session, conversation_id, limit, before_id)

    # Opening a thread implies delivery for everything already in it.
    await message_service.mark_delivered(
        session,
        current_user.id,
        [m.id for m in history if m.sender_id not in (None, current_user.id)],
    )
    return [serialize_message(m) for m in history]


@router.post("", response_model=MessagePublic, status_code=status.HTTP_201_CREATED)
async def send_message(
    conversation_id: int,
    payload: SendMessageRequest,
    current_user: CurrentUser,
    session: SessionDep,
):
    conversation, _ = await conversation_service.require_membership(
        session, conversation_id, current_user.id
    )
    if not payload.body.strip() and not payload.attachment_url:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Message is empty")

    if payload.reply_to_id is not None:
        parent = await message_service.load_message(session, payload.reply_to_id)
        if parent is None or parent.conversation_id != conversation_id:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Cannot reply to that message")

    message = await message_service.create_message(
        session,
        conversation,
        sender_id=current_user.id,
        body=payload.body,
        kind=payload.kind,
        reply_to_id=payload.reply_to_id,
        attachment_url=payload.attachment_url,
        attachment_name=payload.attachment_name,
        attachment_mime=payload.attachment_mime,
        attachment_size=payload.attachment_size,
        attachment_duration_ms=payload.attachment_duration_ms,
    )
    await message_service.broadcast_new_message(conversation, message, payload.client_id)
    return serialize_message(message)


@router.patch("/{message_id}", response_model=MessagePublic)
async def edit_message(
    conversation_id: int,
    message_id: int,
    payload: EditMessageRequest,
    current_user: CurrentUser,
    session: SessionDep,
):
    """Edit your own text. Attachments and system messages are not editable."""
    conversation, _ = await conversation_service.require_membership(
        session, conversation_id, current_user.id
    )
    message = await message_service.load_message(session, message_id)
    if message is None or message.conversation_id != conversation_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Message not found")
    if message.sender_id != current_user.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You can only edit your own messages")
    if message.deleted_at is not None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "That message was deleted")
    if message.kind is not MessageKind.text:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Only text messages can be edited")

    message = await message_service.edit_body(session, message, payload.body.strip())
    serialized = serialize_message(message)
    await hub.broadcast(
        conversation_service.member_ids(conversation),
        "message:updated",
        serialized.model_dump(mode="json"),
    )
    return serialized


@router.post(
    "/{message_id}/forward",
    response_model=list[MessagePublic],
    status_code=status.HTTP_201_CREATED,
)
async def forward_message(
    conversation_id: int,
    message_id: int,
    payload: ForwardMessageRequest,
    current_user: CurrentUser,
    session: SessionDep,
):
    """Copy one message into other conversations the caller belongs to."""
    await conversation_service.require_membership(session, conversation_id, current_user.id)
    source = await message_service.load_message(session, message_id)
    if source is None or source.conversation_id != conversation_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Message not found")
    if source.deleted_at is not None or source.kind is MessageKind.system:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "That message cannot be forwarded")

    created: list = []
    for target_id in dict.fromkeys(payload.conversation_ids):
        # Membership is re-checked per target so this cannot be used to post
        # into a conversation the caller is not part of.
        target, _ = await conversation_service.require_membership(
            session, target_id, current_user.id
        )
        copy = await message_service.forward_message(session, source, target, current_user.id)
        await message_service.broadcast_new_message(target, copy)
        created.append(serialize_message(copy))

    return created


@router.post("/read", status_code=status.HTTP_204_NO_CONTENT)
async def mark_read(conversation_id: int, current_user: CurrentUser, session: SessionDep):
    """Called when the thread is open and focused."""
    await conversation_service.require_membership(session, conversation_id, current_user.id)
    await message_service.mark_conversation_read(session, conversation_id, current_user.id)


@router.post("/{message_id}/reactions", response_model=MessagePublic)
async def react(
    conversation_id: int,
    message_id: int,
    payload: ReactRequest,
    current_user: CurrentUser,
    session: SessionDep,
):
    conversation, _ = await conversation_service.require_membership(
        session, conversation_id, current_user.id
    )
    message = await message_service.load_message(session, message_id)
    if message is None or message.conversation_id != conversation_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Message not found")

    message = await message_service.toggle_reaction(
        session, message, current_user.id, payload.emoji
    )
    serialized = serialize_message(message)
    await hub.broadcast(
        conversation_service.member_ids(conversation),
        "message:updated",
        serialized.model_dump(mode="json"),
    )
    return serialized


@router.delete("/{message_id}", response_model=MessagePublic)
async def delete_message(
    conversation_id: int,
    message_id: int,
    current_user: CurrentUser,
    session: SessionDep,
):
    """Delete for everyone — soft delete so the "message deleted" tombstone
    stays in the thread, matching Signal."""
    conversation, _ = await conversation_service.require_membership(
        session, conversation_id, current_user.id
    )
    message = await message_service.load_message(session, message_id)
    if message is None or message.conversation_id != conversation_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Message not found")
    if message.sender_id != current_user.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You can only delete your own messages")

    message = await message_service.soft_delete(session, message)
    serialized = serialize_message(message)
    await hub.broadcast(
        conversation_service.member_ids(conversation),
        "message:updated",
        serialized.model_dump(mode="json"),
    )
    return serialized
