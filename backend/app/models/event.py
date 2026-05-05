from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

EventCategory = Literal["life", "health", "work", "project", "finance", "travel", "other"]


class EventOut(BaseModel):
    id: int
    date: str | None
    title: str
    description: str
    category: str
    source: str
    created_at: str | None = None


class EventCreateIn(BaseModel):
    title: str = Field(min_length=1)
    description: str = ""
    category: EventCategory = "other"
    date: str | None = None  # YYYY-MM-DD; defaults to today on insert if omitted
    source: str = "manual"
