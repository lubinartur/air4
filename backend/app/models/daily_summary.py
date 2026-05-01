"""Aggregated daily view over events (Time Layers v1)."""

from __future__ import annotations

import uuid
from datetime import date, datetime

from sqlalchemy import JSON, Date, DateTime, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


def _uuid_str() -> str:
    return str(uuid.uuid4())


class DailySummary(Base):
    __tablename__ = "daily_summaries"
    __table_args__ = (UniqueConstraint("date", name="uq_daily_summaries_date"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid_str)
    date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    summary_text: Mapped[str] = mapped_column(String, nullable=False)
    event_ids: Mapped[list[str]] = mapped_column(JSON, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
