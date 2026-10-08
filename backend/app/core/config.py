"""Application settings, loaded from the environment with sane local defaults."""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "Signal Clone API"
    api_prefix: str = "/api"

    # SQLite by default. On Render, point this at a mounted disk, e.g.
    # sqlite+aiosqlite:////var/data/signal.db
    database_url: str = "sqlite+aiosqlite:///./signal.db"

    jwt_secret: str = "dev-secret-change-me"
    jwt_algorithm: str = "HS256"
    access_token_ttl_minutes: int = 60 * 24 * 30

    # Verification is mocked: every OTP request "sends" this code.
    mock_otp_code: str = "123456"

    # Comma separated list, or "*" to allow everything.
    cors_origins: str = "*"

    # Seed the demo dataset the first time the database is created.
    seed_on_startup: bool = True

    # Attachments are written here and served from /uploads. Like the SQLite
    # file, this lives on the container filesystem: durable only if the host
    # gives you a persistent disk.
    upload_dir: str = "uploads"
    max_upload_mb: int = 15

    @property
    def cors_origin_list(self) -> list[str]:
        if self.cors_origins.strip() == "*":
            return ["*"]
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
