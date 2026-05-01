"""Weekly aggregation over daily summaries (Time Layers)."""

from __future__ import annotations

import uuid
from datetime import date, datetime

from sqlalchemy import JSON, Date, DateTime, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


def _uuid_str() -> str:
    return str(uuid.uuid4())


class WeeklyReflection(Base):
    __tablename__ = "weekly_reflections"
    __table_args__ = (UniqueConstraint("week_start_date", name="uq_weekly_reflections_week_start"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid_str)
    week_start_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    reflection_text: Mapped[str] = mapped_column(String, nullable=False)
    daily_summary_ids: Mapped[list[str]] = mapped_column(JSON, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
