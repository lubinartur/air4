from __future__ import annotations

from pydantic import BaseModel


class UserFactOut(BaseModel):
    id: int
    key: str
    value: str | None
    source: str
    created_at: str | None = None
    updated_at: str | None = None
