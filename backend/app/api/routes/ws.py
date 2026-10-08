"""The websocket endpoint: `/api/ws?token=<jwt>`.

Inbound frames the client may send:
    {"type": "ping"}
    {"type": "typing",    "payload": {"conversation_id": 1, "is_typing": true}}
    {"type": "delivered", "payload": {"message_ids": [12, 13]}}
    {"type": "read",      "payload": {"conversation_id": 1}}
    {"type": "message:send", "payload": {"conversation_id": 1, "body": "hi",
                                         "client_id": "..."}}

Outbound frames are documented in `app/realtime/hub.py`.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect
from sqlalchemy import select

from app.core.security import decode_access_token
from app.db.models import ConversationMember, MessageKind, User, utcnow
from app.db.session import SessionLocal
from app.realtime.hub import hub
from app.schemas import SendMessageRequest
from app.services import conversations as conversation_service
from app.services import messages as message_service
from app.services.serializers import serialize_user

logger = logging.getLogger(__name__)
router = APIRouter()


async def _peer_ids(session, user_id: int) -> set[int]:
    """Everyone who shares at least one conversation with this user — the
    audience for presence updates."""
    my_conversations = select(ConversationMember.conversation_id).where(
        ConversationMember.user_id == user_id
    )
    result = await session.execute(
        select(ConversationMember.user_id)
        .where(ConversationMember.conversation_id.in_(my_conversations))
        .distinct()
    )
    return {uid for uid in result.scalars() if uid != user_id}


async def _set_presence(user_id: int, online: bool) -> None:
    async with SessionLocal() as session:
        user = await session.get(User, user_id)
        if user is None:
            return
        user.is_online = online
        user.last_seen_at = utcnow()
        await session.commit()

        payload = serialize_user(user).model_dump(mode="json")
        payload["is_online"] = online
        await hub.broadcast(await _peer_ids(session, user_id), "presence", payload)


@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket, token: str = Query(default="")):
    user_id = decode_access_token(token)
    if user_id is None:
        await websocket.close(code=4401)
        return

    async with SessionLocal() as session:
        if await session.get(User, user_id) is None:
            await websocket.close(code=4401)
            return

    await websocket.accept()
    first_socket = await hub.connect(user_id, websocket)
    if first_socket:
        await _set_presence(user_id, True)

    # Tell the client who is online right now so it can paint dots immediately.
    async with SessionLocal() as session:
        peers = await _peer_ids(session, user_id)
    await websocket.send_json(
        {
            "type": "ready",
            "payload": {
                "user_id": user_id,
                "online_user_ids": [uid for uid in peers if hub.is_online(uid)],
            },
        }
    )

    try:
        while True:
            frame = await websocket.receive_json()
            await _handle_frame(user_id, frame)
    except WebSocketDisconnect:
        pass
    except Exception:
        logger.exception("websocket error for user %s", user_id)
    finally:
        last_socket = await hub.disconnect(user_id, websocket)
        if last_socket:
            await _set_presence(user_id, False)


async def _handle_frame(user_id: int, frame: dict) -> None:
    event = frame.get("type")
    payload = frame.get("payload") or {}

    if event == "ping":
        await hub.send_to_user(user_id, "pong", {})
        return

    if event == "typing":
        conversation_id = payload.get("conversation_id")
        if not conversation_id:
            return
        async with SessionLocal() as session:
            conversation = await conversation_service.load_conversation(session, conversation_id)
            if conversation is None or user_id not in conversation_service.member_ids(conversation):
                return
            user = await session.get(User, user_id)
        await hub.broadcast(
            conversation_service.member_ids(conversation),
            "typing",
            {
                "conversation_id": conversation_id,
                "user_id": user_id,
                "display_name": user.display_name if user else "",
                "is_typing": bool(payload.get("is_typing")),
            },
            exclude_user_id=user_id,
        )
        return

    if event == "delivered":
        ids = [int(i) for i in payload.get("message_ids", []) if str(i).isdigit()]
        async with SessionLocal() as session:
            await message_service.mark_delivered(session, user_id, ids)
        return

    if event == "read":
        conversation_id = payload.get("conversation_id")
        if not conversation_id:
            return
        async with SessionLocal() as session:
            member = await conversation_service.get_member(session, conversation_id, user_id)
            if member is None:
                return
            await message_service.mark_conversation_read(session, conversation_id, user_id)
        return

    if event == "message:send":
        conversation_id = payload.get("conversation_id")
        if not conversation_id:
            return
        try:
            request = SendMessageRequest(**{k: v for k, v in payload.items() if k != "conversation_id"})
        except Exception:
            return
        if not request.body.strip() and not request.attachment_url:
            return
        async with SessionLocal() as session:
            conversation = await conversation_service.load_conversation(session, conversation_id)
            if conversation is None or user_id not in conversation_service.member_ids(conversation):
                return
            message = await message_service.create_message(
                session,
                conversation,
                sender_id=user_id,
                body=request.body,
                kind=request.kind if request.kind is not MessageKind.system else MessageKind.text,
                reply_to_id=request.reply_to_id,
                attachment_url=request.attachment_url,
                attachment_name=request.attachment_name,
                attachment_mime=request.attachment_mime,
                attachment_size=request.attachment_size,
            )
            await message_service.broadcast_new_message(conversation, message, request.client_id)
        return
