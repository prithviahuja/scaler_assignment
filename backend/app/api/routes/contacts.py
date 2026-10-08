"""Address book and user directory."""

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.orm import joinedload

from app.api.deps import CurrentUser, SessionDep
from app.db.models import Contact, User
from app.schemas import AddContactRequest, ContactPublic, UserPublic
from app.services import conversations as conversation_service
from app.services.serializers import serialize_contact, serialize_user

router = APIRouter(prefix="/contacts", tags=["contacts"])


@router.get("", response_model=list[ContactPublic])
async def list_contacts(current_user: CurrentUser, session: SessionDep):
    result = await session.execute(
        select(Contact)
        .where(Contact.owner_id == current_user.id)
        .options(joinedload(Contact.contact_user))
        .order_by(Contact.id.desc())
    )
    contacts = list(result.scalars().unique())
    contacts.sort(key=lambda c: (c.nickname or c.contact_user.display_name).lower())
    return [serialize_contact(c) for c in contacts]


@router.post("", response_model=ContactPublic, status_code=status.HTTP_201_CREATED)
async def add_contact(payload: AddContactRequest, current_user: CurrentUser, session: SessionDep):
    """Add by phone or username. The person must already exist on the platform."""
    if not payload.phone and not payload.username:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, "Provide a phone number or username"
        )

    query = select(User)
    if payload.phone:
        phone = "".join(ch for ch in payload.phone if ch.isdigit() or ch == "+")
        query = query.where(User.phone == phone)
    else:
        handle = payload.username.strip().lstrip("@").lower()
        query = query.where(func.lower(User.username) == handle)

    target = (await session.execute(query)).scalar_one_or_none()
    if target is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Nobody on Signal matches that")
    if target.id == current_user.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "That is you")

    existing = await session.execute(
        select(Contact).where(
            Contact.owner_id == current_user.id, Contact.contact_user_id == target.id
        )
    )
    contact = existing.scalar_one_or_none()
    if contact is None:
        contact = Contact(
            owner_id=current_user.id,
            contact_user_id=target.id,
            nickname=payload.nickname,
        )
        session.add(contact)
        await session.commit()
        await session.refresh(contact)

    return serialize_contact(contact)


@router.delete("/{contact_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_contact(contact_id: int, current_user: CurrentUser, session: SessionDep):
    contact = await session.get(Contact, contact_id)
    if contact is None or contact.owner_id != current_user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Contact not found")
    await session.delete(contact)
    await session.commit()


@router.get("/directory", response_model=list[UserPublic])
async def search_directory(
    current_user: CurrentUser,
    session: SessionDep,
    q: str = Query(default="", max_length=120),
    limit: int = Query(default=30, ge=1, le=100),
):
    """Everyone except the caller, optionally filtered — used by the
    "new chat" and "add members" pickers."""
    if q.strip():
        users = await conversation_service.search_users(session, current_user.id, q.strip(), limit)
    else:
        result = await session.execute(
            select(User).where(User.id != current_user.id).order_by(User.display_name).limit(limit)
        )
        users = list(result.scalars())
    return [serialize_user(u) for u in users]
