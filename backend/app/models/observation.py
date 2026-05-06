from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

ObservationType = Literal["pattern", "anomaly", "milestone", "reminder"]


class ObservationOut(BaseModel):
    id: int
    title: str
    body: str
    observation_type: ObservationType = "pattern"
    is_read: bool = False
    created_at: str | None = None


class ObservationGenerateOut(BaseModel):
    created: int = Field(0, description="How many observations were created")
    cooldown_days_remaining: float | None = None

