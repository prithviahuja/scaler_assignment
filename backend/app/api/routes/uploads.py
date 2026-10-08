"""Attachment uploads.

Files are stored on the local filesystem under `settings.upload_dir` and served
back as static assets from `/uploads`. That keeps the stack to SQLite + disk as
the assignment specifies; swapping in S3 or Cloudinary would only mean changing
`_persist` and the returned URL.

The client uploads first and sends the message second, so a message row never
references a file that failed to store.
"""

from __future__ import annotations

import mimetypes
import re
import uuid
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, UploadFile, status

from app.api.deps import CurrentUser
from app.core.config import settings
from app.schemas import UploadResponse

router = APIRouter(prefix="/uploads", tags=["uploads"])

IMAGE_MIME_TYPES = {
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp",
}

# Browsers record to webm/opus (Chrome, Firefox) or mp4/aac (Safari).
AUDIO_MIME_TYPES = {
    "audio/webm",
    "audio/ogg",
    "audio/mpeg",
    "audio/mp4",
    "audio/wav",
    "audio/x-m4a",
}

FILE_MIME_TYPES = {
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/zip",
    "application/x-zip-compressed",
    "text/plain",
    "text/csv",
    "application/json",
}

ALLOWED_MIME_TYPES = IMAGE_MIME_TYPES | AUDIO_MIME_TYPES | FILE_MIME_TYPES

# Extensions we are willing to write to disk, whatever the browser claims.
SAFE_EXTENSIONS = {
    ".jpg", ".jpeg", ".png", ".gif", ".webp",
    ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
    ".zip", ".txt", ".csv", ".json",
    ".webm", ".ogg", ".mp3", ".m4a", ".wav",
}

MAX_FILENAME_LENGTH = 120


def _safe_extension(filename: str | None, content_type: str) -> str:
    """Pick an extension we trust, preferring the original one."""
    suffix = Path(filename or "").suffix.lower()
    if suffix in SAFE_EXTENSIONS:
        return suffix
    guessed = mimetypes.guess_extension(content_type) or ""
    return guessed if guessed in SAFE_EXTENSIONS else ".bin"


def _display_name(filename: str | None) -> str:
    """Strip any path components the browser sent and keep it printable."""
    base = Path(filename or "attachment").name
    cleaned = re.sub(r'[\x00-\x1f<>:"/\\|?*]', "", base).strip() or "attachment"
    return cleaned[:MAX_FILENAME_LENGTH]


def _kind_for(content_type: str) -> str:
    if content_type in IMAGE_MIME_TYPES:
        return "image"
    if content_type in AUDIO_MIME_TYPES:
        return "audio"
    return "file"


@router.post("", response_model=UploadResponse, status_code=status.HTTP_201_CREATED)
async def upload_attachment(current_user: CurrentUser, file: UploadFile = File(...)):
    """Store one file and return the metadata to attach to a message."""
    content_type = (file.content_type or "application/octet-stream").split(";")[0].strip()
    if content_type not in ALLOWED_MIME_TYPES:
        raise HTTPException(
            status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            "That file type is not supported",
        )

    max_bytes = settings.max_upload_mb * 1024 * 1024
    payload = await file.read(max_bytes + 1)
    if len(payload) > max_bytes:
        raise HTTPException(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            f"Files must be {settings.max_upload_mb} MB or smaller",
        )
    if not payload:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "That file is empty")

    extension = _safe_extension(file.filename, content_type)
    stored_name = f"{uuid.uuid4().hex}{extension}"

    directory = Path(settings.upload_dir)
    directory.mkdir(parents=True, exist_ok=True)
    (directory / stored_name).write_bytes(payload)

    return UploadResponse(
        url=f"/uploads/{stored_name}",
        name=_display_name(file.filename),
        mime=content_type,
        size=len(payload),
        kind=_kind_for(content_type),
    )
