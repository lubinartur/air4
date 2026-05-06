from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

DilemmaStatus = Literal["open", "closed"]


class DilemmaCreateIn(BaseModel):
    text: str


class DilemmaOut(BaseModel):
    id: int
    title: str
    description: str | None = None
    options: str | None = None
    analysis: str | None = None
    recommendation: str | None = None
    status: DilemmaStatus = "open"
    created_at: str | None = None
    followup_due: str | None = None
    followup_done: bool = False
    followup_answer: str | None = None


class DilemmaFollowupIn(BaseModel):
    answer: str = Field(..., min_length=1)

