"""Conversation inbox, direct threads, and group management."""

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import select

from app.api.deps import CurrentUser, SessionDep
from app.db.models import (
    Conversation,
    ConversationMember,
    ConversationType,
    MemberRole,
    Message,
    MessageKind,
    User,
)
from app.realtime.hub import hub
from app.schemas import (
    AddMembersRequest,
    ConversationPublic,
    ConversationSettingsRequest,
    CreateDirectRequest,
    CreateGroupRequest,
    MemberPublic,
    SearchResults,
    UpdateGroupRequest,
)
from app.services import conversations as conversation_service
from app.services import messages as message_service
from app.services.serializers import (
    serialize_conversation,
    serialize_member,
    serialize_message,
    serialize_user,
)

router = APIRouter(prefix="/conversations", tags=["conversations"])


async def _present(session, conversation: Conversation, member: ConversationMember):
    """Attach the per-viewer bits (unread count, last message) to a conversation."""
    return serialize_conversation(
        conversation,
        member,
        unread_count=await conversation_service.unread_count(session, conversation.id, member),
        last_message=await conversation_service.last_message(session, conversation.id),
    )


async def _announce(session, conversation: Conversation, body: str) -> None:
    """Persist a system message and push it to every member."""
    message = await message_service.create_message(
        session, conversation, sender_id=None, body=body, kind=MessageKind.system
    )
    await message_service.broadcast_new_message(conversation, message)


async def _push_conversation_update(session, conversation: Conversation) -> None:
    """Re-send the conversation to each member from their own point of view."""
    for member in conversation.members:
        payload = await _present(session, conversation, member)
        await hub.send_to_user(
            member.user_id, "conversation:update", payload.model_dump(mode="json")
        )


# ------------------------------------------------------------------- inbox


@router.get("", response_model=list[ConversationPublic])
async def list_conversations(current_user: CurrentUser, session: SessionDep):
    """The left-hand chat list, most recent activity first (pinned on top)."""
    conversations = await conversation_service.list_for_user(session, current_user.id)
    presented = []
    for conversation in conversations:
        member = next(m for m in conversation.members if m.user_id == current_user.id)
        presented.append(await _present(session, conversation, member))
    presented.sort(key=lambda c: (not c.is_pinned, -c.last_message_at.timestamp()))
    return presented


@router.get("/search", response_model=SearchResults)
async def search(
    current_user: CurrentUser,
    session: SessionDep,
    q: str = Query(min_length=1, max_length=120),
):
    """One search box over conversations, people and message bodies."""
    term = q.strip().lower()

    conversations = await conversation_service.list_for_user(session, current_user.id)
    matched_conversations = []
    my_conversation_ids = []
    for conversation in conversations:
        member = next(m for m in conversation.members if m.user_id == current_user.id)
        my_conversation_ids.append(conversation.id)
        presented = await _present(session, conversation, member)
        if term in presented.title.lower():
            matched_conversations.append(presented)

    people = await conversation_service.search_users(session, current_user.id, term)

    hits = []
    if my_conversation_ids:
        result = await session.execute(
            select(Message)
            .where(
                Message.conversation_id.in_(my_conversation_ids),
                Message.deleted_at.is_(None),
                Message.body.ilike(f"%{term}%"),
            )
            .options(*message_service.MESSAGE_LOADERS)
            .order_by(Message.created_at.desc())
            .limit(30)
        )
        hits = list(result.scalars().unique())

    return SearchResults(
        conversations=matched_conversations,
        contacts=[serialize_user(u) for u in people],
        messages=[serialize_message(m) for m in hits],
    )


@router.get("/{conversation_id}", response_model=ConversationPublic)
async def get_conversation(conversation_id: int, current_user: CurrentUser, session: SessionDep):
    conversation, member = await conversation_service.require_membership(
        session, conversation_id, current_user.id
    )
    return await _present(session, conversation, member)


# ------------------------------------------------------------------ creation


@router.post("/direct", response_model=ConversationPublic, status_code=status.HTTP_201_CREATED)
async def create_direct(
    payload: CreateDirectRequest, current_user: CurrentUser, session: SessionDep
):
    """Open (or reuse) a one-on-one thread with another user."""
    target = await session.get(User, payload.user_id)
    if target is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")

    conversation = await conversation_service.create_direct(session, current_user.id, target.id)
    member = next(m for m in conversation.members if m.user_id == current_user.id)
    presented = await _present(session, conversation, member)

    # Let the other participant's chat list know a thread appeared.
    for other in conversation.members:
        if other.user_id == current_user.id:
            continue
        other_view = await _present(session, conversation, other)
        await hub.send_to_user(
            other.user_id, "conversation:new", other_view.model_dump(mode="json")
        )
    return presented


@router.post("/groups", response_model=ConversationPublic, status_code=status.HTTP_201_CREATED)
async def create_group(
    payload: CreateGroupRequest, current_user: CurrentUser, session: SessionDep
):
    conversation = await conversation_service.create_group(
        session,
        creator_id=current_user.id,
        name=payload.name.strip(),
        member_user_ids=payload.member_ids,
        description=payload.description,
        avatar_color=payload.avatar_color,
    )
    member = next(m for m in conversation.members if m.user_id == current_user.id)
    presented = await _present(session, conversation, member)

    for other in conversation.members:
        if other.user_id == current_user.id:
            continue
        other_view = await _present(session, conversation, other)
        await hub.send_to_user(
            other.user_id, "conversation:new", other_view.model_dump(mode="json")
        )
    return presented


# ------------------------------------------------------------ group settings


@router.patch("/{conversation_id}", response_model=ConversationPublic)
async def update_group(
    conversation_id: int,
    payload: UpdateGroupRequest,
    current_user: CurrentUser,
    session: SessionDep,
):
    conversation, member = await conversation_service.require_admin(
        session, conversation_id, current_user.id
    )
    data = payload.model_dump(exclude_unset=True)
    renamed = "name" in data and data["name"] and data["name"] != conversation.name
    timer_changed = (
        "disappearing_seconds" in data
        and data["disappearing_seconds"] != conversation.disappearing_seconds
    )

    for field, value in data.items():
        setattr(conversation, field, value)
    await session.commit()

    if renamed:
        await _announce(
            session, conversation, f"{current_user.display_name} changed the group name"
        )
    if timer_changed:
        seconds = conversation.disappearing_seconds
        note = "off" if not seconds else f"{seconds} seconds"
        await _announce(
            session, conversation, f"{current_user.display_name} set disappearing messages to {note}"
        )

    await _push_conversation_update(session, conversation)
    return await _present(session, conversation, member)


@router.patch("/{conversation_id}/settings", response_model=ConversationPublic)
async def update_my_settings(
    conversation_id: int,
    payload: ConversationSettingsRequest,
    current_user: CurrentUser,
    session: SessionDep,
):
    """Per-member preferences (mute, pin) — no admin rights needed."""
    conversation, member = await conversation_service.require_membership(
        session, conversation_id, current_user.id
    )
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(member, field, value)
    await session.commit()
    return await _present(session, conversation, member)


@router.get("/{conversation_id}/members", response_model=list[MemberPublic])
async def list_members(conversation_id: int, current_user: CurrentUser, session: SessionDep):
    conversation, _ = await conversation_service.require_membership(
        session, conversation_id, current_user.id
    )
    members = sorted(
        conversation.members,
        key=lambda m: (m.role is not MemberRole.admin, m.user.display_name.lower()),
    )
    return [serialize_member(m) for m in members]


@router.post("/{conversation_id}/members", response_model=list[MemberPublic])
async def add_members(
    conversation_id: int,
    payload: AddMembersRequest,
    current_user: CurrentUser,
    session: SessionDep,
):
    conversation, _ = await conversation_service.require_admin(
        session, conversation_id, current_user.id
    )
    existing_ids = set(conversation_service.member_ids(conversation))
    added_names: list[str] = []
    added_ids: set[int] = set()

    for user_id in payload.user_ids:
        if user_id in existing_ids:
            continue
        user = await session.get(User, user_id)
        if user is None:
            continue
        session.add(
            ConversationMember(
                conversation_id=conversation.id, user_id=user_id, role=MemberRole.member
            )
        )
        existing_ids.add(user_id)
        added_ids.add(user_id)
        added_names.append(user.display_name)

    if not added_names:
        return [serialize_member(m) for m in conversation.members]

    await session.commit()
    conversation = await conversation_service.load_conversation(session, conversation_id)
    await _announce(
        session,
        conversation,
        f"{current_user.display_name} added {', '.join(added_names)}",
    )

    for member in conversation.members:
        view = await _present(session, conversation, member)
        event = "conversation:new" if member.user_id in added_ids else "conversation:update"
        await hub.send_to_user(member.user_id, event, view.model_dump(mode="json"))

    return [serialize_member(m) for m in conversation.members]


@router.delete("/{conversation_id}/members/{user_id}", response_model=list[MemberPublic])
async def remove_member(
    conversation_id: int, user_id: int, current_user: CurrentUser, session: SessionDep
):
    """Admins can remove anyone; anyone can remove themselves (leave)."""
    conversation, me = await conversation_service.require_membership(
        session, conversation_id, current_user.id
    )
    if conversation.type is not ConversationType.group:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Not a group conversation")

    leaving = user_id == current_user.id
    if not leaving and me.role is not MemberRole.admin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Admins only")

    target = next((m for m in conversation.members if m.user_id == user_id), None)
    if target is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not a member of this group")

    admins = [m for m in conversation.members if m.role is MemberRole.admin]
    if target.role is MemberRole.admin and len(admins) == 1 and len(conversation.members) > 1:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Promote another admin before leaving"
        )

    removed_name = target.user.display_name
    await session.delete(target)
    await session.commit()

    conversation = await conversation_service.load_conversation(session, conversation_id)
    if conversation is None:
        return []

    await _announce(
        session,
        conversation,
        f"{removed_name} left the group"
        if leaving
        else f"{current_user.display_name} removed {removed_name}",
    )
    await _push_conversation_update(session, conversation)
    # The person who is gone gets told to drop the thread from their list.
    await hub.send_to_user(
        user_id, "conversation:removed", {"conversation_id": conversation_id}
    )
    return [serialize_member(m) for m in conversation.members]


@router.post("/{conversation_id}/members/{user_id}/promote", response_model=list[MemberPublic])
async def promote_member(
    conversation_id: int, user_id: int, current_user: CurrentUser, session: SessionDep
):
    conversation, _ = await conversation_service.require_admin(
        session, conversation_id, current_user.id
    )
    target = next((m for m in conversation.members if m.user_id == user_id), None)
    if target is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not a member of this group")

    target.role = MemberRole.admin
    await session.commit()
    await _push_conversation_update(session, conversation)
    return [serialize_member(m) for m in conversation.members]
