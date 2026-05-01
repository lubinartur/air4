"""Event Memory API schemas."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class EventCreateRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    text: str = Field(..., min_length=1)


class EventMetadataResponse(BaseModel):
    """Shape of event.metadata from Observer parser (extra keys allowed)."""

    model_config = ConfigDict(extra="allow")

    domain: str
    source: str
    raw_length: int
    parser_version: str | None = None
    signals: list[str]


class EventResponse(BaseModel):
    model_config = ConfigDict(from_attributes=False)

    id: str
    timestamp: datetime
    original_text: str
    processed_text: str
    metadata: dict[str, Any]
    embedding_id: str | None


class EventListResponse(BaseModel):
    items: list[EventResponse]
    count: int


class EventSearchResponse(BaseModel):
    items: list[EventResponse]
    count: int
    query: str


class EventSearchParams(BaseModel):
    """GET /search query string (strip whitespace, validate bounds)."""

    model_config = ConfigDict(str_strip_whitespace=True)

    q: str = Field(..., min_length=1)
    limit: int = Field(10, ge=1, le=100)
