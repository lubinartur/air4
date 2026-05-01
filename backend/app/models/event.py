"""Append-only event memory and embedding rows (vector as JSON until external vector store)."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import JSON, DateTime, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


def _uuid_str() -> str:
    return str(uuid.uuid4())


class Embedding(Base):
    """Embedding vector stored as JSON list[float]; swap storage via repository later."""

    __tablename__ = "embeddings"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid_str)
    event_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("events.id", ondelete="CASCADE", use_alter=True),
        nullable=False,
        index=True,
    )
    vector: Mapped[list[float]] = mapped_column(JSON, nullable=False)


class Event(Base):
    """Source-of-truth event row; metadata is flexible JSON."""

    __tablename__ = "events"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid_str)
    timestamp: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    original_text: Mapped[str] = mapped_column(String, nullable=False)
    processed_text: Mapped[str] = mapped_column(String, nullable=False)
    metadata_: Mapped[dict[str, Any]] = mapped_column("metadata", JSON, nullable=False)
    embedding_id: Mapped[str | None] = mapped_column(
        String(36),
        ForeignKey("embeddings.id", ondelete="SET NULL", use_alter=True),
        nullable=True,
    )
