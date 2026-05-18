from __future__ import annotations

from fastapi import APIRouter

from database import fetch_all, fetch_one, get_db
from schemas import EventOut, EventsListOut

router = APIRouter()

_EVENTS_LIMIT = 50


@router.get("/events", response_model=EventsListOut)
def list_events() -> EventsListOut:
    with get_db() as conn:
        total_row = fetch_one(
            conn,
            "SELECT COUNT(*) AS n FROM events WHERE COALESCE(archived, 0) = 0",
        )
        rows = fetch_all(
            conn,
            """
            SELECT id, date, title, description, domain, category, importance, created_at
            FROM events
            WHERE COALESCE(archived, 0) = 0
            ORDER BY date DESC, datetime(created_at) DESC, id DESC
            LIMIT ?
            """,
            (_EVENTS_LIMIT,),
        )

    total = int(total_row["n"]) if total_row else 0
    events = [EventOut(**r) for r in rows]
    return EventsListOut(events=events, total=total)
