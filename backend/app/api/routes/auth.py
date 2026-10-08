"""Mocked phone-number onboarding.

The flow mirrors Signal's (enter number -> receive code -> pick a profile) but
the code is always `settings.mock_otp_code` and nothing is actually sent.
"""

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import func, select

from app.api.deps import CurrentUser, SessionDep
from app.core.config import settings
from app.core.security import create_access_token
from app.db.models import User, utcnow
from app.schemas import (
    AuthResponse,
    LoginRequest,
    RegisterRequest,
    StartVerificationRequest,
    StartVerificationResponse,
    UpdateProfileRequest,
    UserPublic,
)
from app.services.serializers import serialize_user

router = APIRouter(prefix="/auth", tags=["auth"])


def _normalise_phone(phone: str) -> str:
    cleaned = "".join(ch for ch in phone if ch.isdigit() or ch == "+")
    if not cleaned:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Enter a valid phone number")
    return cleaned


async def _find_by_phone(session, phone: str) -> User | None:
    result = await session.execute(select(User).where(User.phone == phone))
    return result.scalar_one_or_none()


@router.post("/start", response_model=StartVerificationResponse)
async def start_verification(payload: StartVerificationRequest, session: SessionDep):
    """Step 1 — "send" the verification code."""
    phone = _normalise_phone(payload.phone)
    existing = await _find_by_phone(session, phone)
    return StartVerificationResponse(
        phone=phone,
        dev_code=settings.mock_otp_code,
        registered=existing is not None,
    )


@router.post("/register", response_model=AuthResponse, status_code=status.HTTP_201_CREATED)
async def register(payload: RegisterRequest, session: SessionDep):
    """Step 2 — verify the code and create the profile."""
    if payload.code != settings.mock_otp_code:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "That code is incorrect")

    phone = _normalise_phone(payload.phone)
    if await _find_by_phone(session, phone) is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "That number is already registered")

    username = payload.username.strip().lstrip("@") if payload.username else None
    if username:
        taken = await session.execute(
            select(User).where(func.lower(User.username) == username.lower())
        )
        if taken.scalar_one_or_none() is not None:
            raise HTTPException(status.HTTP_409_CONFLICT, "That username is taken")

    user = User(
        phone=phone,
        username=username,
        display_name=payload.display_name.strip(),
        about=payload.about,
        avatar_color=payload.avatar_color,
        last_seen_at=utcnow(),
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)

    return AuthResponse(access_token=create_access_token(user.id), user=serialize_user(user))


@router.post("/login", response_model=AuthResponse)
async def login(payload: LoginRequest, session: SessionDep):
    if payload.code != settings.mock_otp_code:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "That code is incorrect")

    user = await _find_by_phone(session, _normalise_phone(payload.phone))
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No account for that number")

    user.last_seen_at = utcnow()
    await session.commit()
    return AuthResponse(access_token=create_access_token(user.id), user=serialize_user(user))


@router.get("/me", response_model=UserPublic)
async def read_me(current_user: CurrentUser):
    """Used on boot to restore the session from a stored token."""
    return serialize_user(current_user)


@router.patch("/me", response_model=UserPublic)
async def update_me(payload: UpdateProfileRequest, current_user: CurrentUser, session: SessionDep):
    data = payload.model_dump(exclude_unset=True)

    if "username" in data and data["username"]:
        username = data["username"].strip().lstrip("@")
        taken = await session.execute(
            select(User).where(
                func.lower(User.username) == username.lower(), User.id != current_user.id
            )
        )
        if taken.scalar_one_or_none() is not None:
            raise HTTPException(status.HTTP_409_CONFLICT, "That username is taken")
        data["username"] = username

    for field, value in data.items():
        setattr(current_user, field, value)
    await session.commit()
    await session.refresh(current_user)
    return serialize_user(current_user)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(current_user: CurrentUser, session: SessionDep):
    """Tokens are stateless, so this just records the last-seen time."""
    current_user.is_online = False
    current_user.last_seen_at = utcnow()
    await session.commit()
