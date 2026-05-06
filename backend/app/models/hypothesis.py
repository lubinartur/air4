from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

HypothesisStatus = Literal["pending", "confirmed", "rejected"]


class HypothesisOut(BaseModel):
    id: int
    text: str
    status: HypothesisStatus
    confirmed_at: str | None = None
    rejected_at: str | None = None
    created_at: str | None = None


class HypothesisGenerateOut(BaseModel):
    created: int = Field(0, description="How many new hypotheses were created")
    cooldown_hours_remaining: float | None = None


class HypothesisUpdateIn(BaseModel):
    status: Literal["confirmed", "rejected"]

