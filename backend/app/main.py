"""FastAPI application factory and startup wiring."""

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.api.routes import auth, contacts, conversations, messages, uploads, ws
from app.core.config import settings
from app.db.migrate import apply_additive_migrations
from app.db.models import Base
from app.db.session import engine

# StaticFiles validates the directory when it is mounted, which happens at
# import time — before the lifespan hook could create it.
UPLOAD_PATH = Path(settings.upload_dir)
UPLOAD_PATH.mkdir(parents=True, exist_ok=True)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    # Pick up columns added since an existing database file was created, so
    # pulling new code never means losing local data.
    await apply_additive_migrations(engine)

    if settings.seed_on_startup:
        from app.seed import seed_if_empty

        await seed_if_empty()

    yield
    await engine.dispose()


app = FastAPI(
    title=settings.app_name,
    version="1.0.0",
    description="Backend for a Signal Messenger clone: mocked auth, contacts, "
    "direct and group conversations, and real-time messaging over websockets.",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

api = APIRouter(prefix=settings.api_prefix)
api.include_router(auth.router)
api.include_router(contacts.router)
api.include_router(conversations.router)
api.include_router(messages.router)
api.include_router(uploads.router)
api.include_router(ws.router)
app.include_router(api)

# Uploaded attachments are served straight from disk at /uploads/<file>.
app.mount("/uploads", StaticFiles(directory=UPLOAD_PATH), name="uploads")


@app.get("/", tags=["health"])
async def root():
    return {"service": settings.app_name, "docs": "/docs", "health": "/health"}


@app.get("/health", tags=["health"])
async def health():
    return {"status": "ok"}
