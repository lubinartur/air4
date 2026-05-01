"""Event Memory HTTP API (append-only events + semantic search)."""

from typing import Any

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.db import get_db
from app.models.event import Event
from app.services import event_service

router = APIRouter()


class CreateEventBody(BaseModel):
    text: str = Field(..., min_length=1)


def _event_to_json(e: Event) -> dict[str, Any]:
    return {
        "id": e.id,
        "timestamp": e.timestamp.isoformat(),
        "original_text": e.original_text,
        "processed_text": e.processed_text,
        "metadata": e.metadata_,
        "embedding_id": e.embedding_id,
    }


@router.post("/event")
def post_event(body: CreateEventBody, db: Session = Depends(get_db)) -> dict[str, Any]:
    event = event_service.create_event(db, body.text)
    return _event_to_json(event)


@router.get("/events")
def get_events(
    limit: int = Query(50, ge=1, le=500),
    db: Session = Depends(get_db),
) -> list[dict[str, Any]]:
    events = event_service.list_events(db, limit=limit)
    return [_event_to_json(e) for e in events]


@router.get("/search")
def get_search(
    q: str = Query(..., min_length=1),
    limit: int = Query(10, ge=1, le=100),
    db: Session = Depends(get_db),
) -> list[dict[str, Any]]:
    events = event_service.search_events(db, query=q, limit=limit)
    return [_event_to_json(e) for e in events]
