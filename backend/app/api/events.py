"""Event Memory HTTP API (append-only events + semantic search)."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.db import get_db
from app.models.event import Event
from app.schemas.event import (
    EventCreateRequest,
    EventListResponse,
    EventResponse,
    EventSearchParams,
    EventSearchResponse,
)
from app.services import event_service

router = APIRouter()


def _event_to_response(e: Event) -> EventResponse:
    return EventResponse(
        id=e.id,
        timestamp=e.timestamp,
        original_text=e.original_text,
        processed_text=e.processed_text,
        metadata=e.metadata_,
        embedding_id=e.embedding_id,
    )


@router.post("/event", response_model=EventResponse)
def post_event(body: EventCreateRequest, db: Session = Depends(get_db)) -> EventResponse:
    event = event_service.create_event(db, body.text)
    return _event_to_response(event)


@router.get("/events", response_model=EventListResponse)
def get_events(
    limit: int = Query(50, ge=1, le=500),
    db: Session = Depends(get_db),
) -> EventListResponse:
    events = event_service.list_events(db, limit=limit)
    items = [_event_to_response(e) for e in events]
    return EventListResponse(items=items, count=len(items))


@router.get("/search", response_model=EventSearchResponse)
def get_search(
    params: Annotated[EventSearchParams, Query()],
    db: Session = Depends(get_db),
) -> EventSearchResponse:
    events = event_service.search_events(db, query=params.q, limit=params.limit)
    items = [_event_to_response(e) for e in events]
    return EventSearchResponse(items=items, count=len(items), query=params.q)
