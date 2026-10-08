"""Shared eager-loading options.

Under async SQLAlchemy a lazy load raises instead of silently emitting SQL, so
every query that feeds a serializer has to spell out what it needs. Keeping the
option tuples here lets `conversations` and `messages` share them without an
import cycle.
"""

from sqlalchemy.orm import joinedload, selectinload

from app.db.models import Conversation, ConversationMember, Message

MESSAGE_LOADERS = (
    joinedload(Message.sender),
    joinedload(Message.reply_to).joinedload(Message.sender),
    selectinload(Message.receipts),
    selectinload(Message.reactions),
)

CONVERSATION_LOADERS = (
    selectinload(Conversation.members).joinedload(ConversationMember.user),
)
