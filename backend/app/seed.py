"""Demo dataset.

Runs once, on the first boot against an empty database, so the app is usable
the moment it is opened. Every seeded account signs in with the same mocked
OTP, which makes it easy to open two browsers and watch messages arrive live.
"""

from __future__ import annotations

import asyncio
from datetime import timedelta

from sqlalchemy import func, select

from app.db.models import (
    Contact,
    Conversation,
    ConversationMember,
    ConversationType,
    MemberRole,
    Message,
    MessageKind,
    MessageReaction,
    MessageReceipt,
    MessageStatus,
    User,
    utcnow,
)
from app.db.session import SessionLocal

# Signal's avatar tiles.
AVATAR_COLORS = ["blue", "burlap", "crimson", "forest", "indigo", "plum", "steel", "taupe", "teal", "ultramarine", "vermilion", "wintergreen"]

PEOPLE = [
    ("+15550100001", "prithvi", "Prithvi Ahuja", "Building things.", "ultramarine"),
    ("+15550100002", "aisha", "Aisha Khan", "Designer. Coffee first.", "plum"),
    ("+15550100003", "rohan", "Rohan Mehta", "Backend @ Scaler", "forest"),
    ("+15550100004", "meera", "Meera Iyer", "PM. Lover of lists.", "crimson"),
    ("+15550100005", "dev", "Dev Sharma", "iOS dev", "steel"),
    ("+15550100006", "sara", "Sara Lopez", "Travelling ✈️", "teal"),
    ("+15550100007", "arjun", "Arjun Nair", "Gym. Code. Repeat.", "burlap"),
    ("+15550100008", "nina", "Nina Patel", "Data person", "indigo"),
]

DIRECT_THREADS: list[tuple[str, str, list[tuple[str, str]]]] = [
    (
        "prithvi",
        "aisha",
        [
            ("aisha", "Hey! Did you get a chance to look at the new mockups?"),
            ("prithvi", "Just opened them. The conversation list looks spot on 👌"),
            ("aisha", "I tightened the bubble spacing to match Signal exactly."),
            ("prithvi", "Noticed. The timestamps inside the bubble are a nice touch."),
            ("aisha", "Let's ship it this week."),
        ],
    ),
    (
        "prithvi",
        "rohan",
        [
            ("rohan", "Websocket fan-out is done. Receipts flow through the hub now."),
            ("prithvi", "Nice. Does it handle multiple tabs for the same user?"),
            ("rohan", "Yep — one socket set per user id, presence flips on the first/last one."),
            ("prithvi", "Perfect, that's exactly what I wanted."),
        ],
    ),
    (
        "prithvi",
        "meera",
        [
            ("meera", "Standup moved to 10:30 tomorrow."),
            ("prithvi", "Works for me."),
            ("meera", "Also, can you demo the group admin controls?"),
            ("prithvi", "Sure, add/remove members and promote to admin are all working."),
        ],
    ),
    (
        "prithvi",
        "dev",
        [
            ("dev", "Is the typing indicator live yet?"),
            ("prithvi", "It is — it times out after a couple of seconds of silence."),
            ("dev", "Beautiful."),
        ],
    ),
    (
        "prithvi",
        "sara",
        [
            ("sara", "Landed! Will be online later tonight."),
            ("prithvi", "Safe travels 🙌"),
        ],
    ),
    (
        "aisha",
        "rohan",
        [
            ("aisha", "Can you add a loading state to the chat pane?"),
            ("rohan", "On it."),
        ],
    ),
]

GROUPS: list[tuple[str, str, str, str, list[str], list[tuple[str, str]]]] = [
    (
        "Signal Clone Team",
        "Shipping the assignment.",
        "ultramarine",
        "prithvi",
        ["aisha", "rohan", "meera", "dev"],
        [
            ("prithvi", "Kicking this off — frontend is Next.js, backend FastAPI."),
            ("rohan", "Schema is in. Users, conversations, members, messages, receipts, reactions."),
            ("aisha", "I'll own the UI so it actually looks like Signal."),
            ("meera", "I'll write the README and the architecture overview."),
            ("dev", "I'll take typing indicators and read receipts."),
            ("prithvi", "Let's aim for a demo by Friday."),
            ("aisha", "Dark mode is done too, by the way 🌙"),
        ],
    ),
    (
        "Weekend Plans 🏔️",
        "Trek planning.",
        "forest",
        "sara",
        ["prithvi", "arjun", "nina", "aisha"],
        [
            ("sara", "Who's in for the Saturday trek?"),
            ("arjun", "In. I'll bring the first-aid kit."),
            ("nina", "Count me in — can someone drive?"),
            ("prithvi", "I can take four people."),
            ("sara", "Sorted. 6am start, don't be late 😅"),
        ],
    ),
    (
        "Design Review",
        "Weekly critique.",
        "plum",
        "aisha",
        ["prithvi", "meera", "nina"],
        [
            ("aisha", "Dropping the latest frames here before the review."),
            ("meera", "Thanks — I'll add comments tonight."),
            ("nina", "The empty states need a second pass."),
        ],
    ),
]


async def seed_if_empty() -> bool:
    """Populate the demo dataset when the users table is empty."""
    async with SessionLocal() as session:
        count = await session.execute(select(func.count(User.id)))
        if (count.scalar() or 0) > 0:
            return False

        now = utcnow()
        users: dict[str, User] = {}
        for index, (phone, username, display_name, about, color) in enumerate(PEOPLE):
            user = User(
                phone=phone,
                username=username,
                display_name=display_name,
                about=about,
                avatar_color=color,
                is_online=False,
                last_seen_at=now - timedelta(minutes=7 * index),
            )
            session.add(user)
            users[username] = user
        await session.flush()

        # Everyone keeps everyone else in their address book, so the pickers
        # have something to show from the first login.
        for owner in users.values():
            for other in users.values():
                if owner.id != other.id:
                    session.add(Contact(owner_id=owner.id, contact_user_id=other.id))

        # Walk backwards in time so the inbox has a believable ordering.
        clock = now - timedelta(hours=30)

        def next_timestamp() -> "object":
            nonlocal clock
            clock += timedelta(minutes=11)
            return clock

        for a_name, b_name, script in DIRECT_THREADS:
            a, b = users[a_name], users[b_name]
            conversation = Conversation(
                type=ConversationType.direct,
                created_by_id=a.id,
                last_message_at=clock,
            )
            session.add(conversation)
            await session.flush()
            session.add_all(
                [
                    ConversationMember(conversation_id=conversation.id, user_id=a.id),
                    ConversationMember(conversation_id=conversation.id, user_id=b.id),
                ]
            )
            await _write_script(session, conversation, users, script, next_timestamp)

        for name, description, color, owner_name, member_names, script in GROUPS:
            owner = users[owner_name]
            conversation = Conversation(
                type=ConversationType.group,
                name=name,
                description=description,
                avatar_color=color,
                created_by_id=owner.id,
                last_message_at=clock,
            )
            session.add(conversation)
            await session.flush()
            session.add(
                ConversationMember(
                    conversation_id=conversation.id, user_id=owner.id, role=MemberRole.admin
                )
            )
            for member_name in member_names:
                session.add(
                    ConversationMember(
                        conversation_id=conversation.id, user_id=users[member_name].id
                    )
                )
            session.add(
                Message(
                    conversation_id=conversation.id,
                    sender_id=None,
                    kind=MessageKind.system,
                    body=f"{owner.display_name} created the group",
                    created_at=next_timestamp(),
                    status=MessageStatus.read,
                )
            )
            await _write_script(session, conversation, users, script, next_timestamp)

        await session.commit()
        return True


async def _write_script(session, conversation, users, script, next_timestamp) -> None:
    """Insert a scripted exchange, with receipts and a couple of reactions."""
    member_rows = await session.execute(
        select(ConversationMember.user_id).where(
            ConversationMember.conversation_id == conversation.id
        )
    )
    participant_ids = list(member_rows.scalars())
    last_message: Message | None = None

    for index, (sender_name, body) in enumerate(script):
        sender = users[sender_name]
        created_at = next_timestamp()
        message = Message(
            conversation_id=conversation.id,
            sender_id=sender.id,
            body=body,
            kind=MessageKind.text,
            created_at=created_at,
            status=MessageStatus.read,
        )
        session.add(message)
        await session.flush()

        # Leave the very last inbound message unread so the chat list shows a badge.
        is_last = index == len(script) - 1
        for user_id in participant_ids:
            if user_id == sender.id:
                continue
            session.add(
                MessageReceipt(
                    message_id=message.id,
                    user_id=user_id,
                    delivered_at=created_at,
                    read_at=None if is_last else created_at,
                )
            )
        if is_last:
            message.status = MessageStatus.delivered

        if index == 1 and len(script) > 2:
            reactor = next(uid for uid in participant_ids if uid != sender.id)
            session.add(
                MessageReaction(message_id=message.id, user_id=reactor, emoji="👍")
            )

        last_message = message

    if last_message is not None:
        conversation.last_message_at = last_message.created_at
        # The sender has read their own thread; recipients have not read the tail.
        for member in await _members(session, conversation.id):
            if member.user_id == last_message.sender_id:
                member.last_read_at = last_message.created_at
            else:
                member.last_read_at = last_message.created_at - timedelta(seconds=1)


async def _members(session, conversation_id: int) -> list[ConversationMember]:
    result = await session.execute(
        select(ConversationMember).where(ConversationMember.conversation_id == conversation_id)
    )
    return list(result.scalars())


async def _main() -> None:
    from app.db.models import Base
    from app.db.session import engine

    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    created = await seed_if_empty()
    print("Seeded demo data." if created else "Database already has users; nothing to do.")
    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(_main())
