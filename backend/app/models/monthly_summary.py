"""Monthly aggregation over weekly reflections (Time Layers)."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import JSON, DateTime, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


def _uuid_str() -> str:
    return str(uuid.uuid4())


class MonthlySummary(Base):
    __tablename__ = "monthly_summaries"
    __table_args__ = (UniqueConstraint("month", name="uq_monthly_summaries_month"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid_str)
    month: Mapped[str] = mapped_column(String(7), nullable=False, index=True)
    summary_text: Mapped[str] = mapped_column(String, nullable=False)
    weekly_reflection_ids: Mapped[list[str]] = mapped_column(JSON, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
