from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

Sphere = Literal["finance", "life", "projects", "health"]
Confidence = Literal["high", "medium", "low"]


class CrossSphereInsightOut(BaseModel):
    id: int
    sphere1: Sphere | None = None
    sphere2: Sphere | None = None
    title: str
    description: str
    confidence: Confidence | None = None
    created_at: str | None = None


class CrossSphereAnalyzeOut(BaseModel):
    created: int = Field(0, description="How many insights were created")
    cooldown_hours_remaining: float | None = None

