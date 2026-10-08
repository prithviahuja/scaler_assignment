"""Lightweight additive migrations for SQLite.

`Base.metadata.create_all` creates missing *tables* but never alters existing
ones, so a database created before a column was added keeps failing every query
that selects it. A real project would use Alembic; this app ships a single
additive step instead — it compares each mapped table against
`PRAGMA table_info` and issues `ALTER TABLE ... ADD COLUMN` for anything
missing, which SQLite does cheaply and without rewriting rows.

Deliberately additive only: nothing here drops or retypes a column, so it can
never destroy data. Renames or type changes still mean recreating the file.
"""

from __future__ import annotations

import logging

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine
from sqlalchemy.schema import CreateColumn

from app.db.models import Base

logger = logging.getLogger(__name__)


async def apply_additive_migrations(engine: AsyncEngine) -> list[str]:
    """Add any model columns the existing tables are missing. Returns what it did."""
    applied: list[str] = []

    async with engine.begin() as connection:
        dialect = connection.dialect

        for table in Base.metadata.sorted_tables:
            exists = await connection.scalar(
                text("SELECT name FROM sqlite_master WHERE type='table' AND name=:name"),
                {"name": table.name},
            )
            if not exists:
                continue  # create_all will build it from scratch

            rows = await connection.execute(text(f"PRAGMA table_info('{table.name}')"))
            present = {row[1] for row in rows}

            for column in table.columns:
                if column.name in present:
                    continue

                # SQLite cannot add a NOT NULL column without a default, so fall
                # back to a nullable one and let the model's Python-side default
                # populate new rows.
                spec = CreateColumn(column).compile(dialect=dialect).string
                if column.default is not None and column.default.is_scalar:
                    literal = _as_sql_literal(column.default.arg)
                    if literal is not None:
                        spec = f"{spec} DEFAULT {literal}"
                elif "NOT NULL" in spec.upper():
                    spec = spec.replace(" NOT NULL", "")

                await connection.execute(text(f"ALTER TABLE {table.name} ADD COLUMN {spec}"))
                applied.append(f"{table.name}.{column.name}")

    if applied:
        logger.info("Applied additive migrations: %s", ", ".join(applied))
    return applied


def _as_sql_literal(value: object) -> str | None:
    if isinstance(value, bool):
        return "1" if value else "0"
    if isinstance(value, (int, float)):
        return str(value)
    if isinstance(value, str):
        escaped = value.replace("'", "''")
        return f"'{escaped}'"
    return None
