from __future__ import annotations

from pydantic import BaseModel, Field


class UserProfileOut(BaseModel):
    id: int
    name: str | None
    context: str | None
    city: str | None = None
    profession: str | None = None
    monthly_income: float | None = None
    goals: str | None = None
    transport: str | None = None
    created_at: str | None = None
    updated_at: str | None = None


class UserProfileUpdate(BaseModel):
    name: str | None = Field(None, description="Display name; null to clear")
    context: str | None = Field(None, description="About me; null to clear")
    city: str | None = Field(None)
    profession: str | None = Field(None)
    monthly_income: float | None = Field(None)
    goals: str | None = Field(None)
    transport: str | None = Field(None)
