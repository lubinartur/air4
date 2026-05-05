from __future__ import annotations

from datetime import date
from typing import Optional

import aiosqlite
from fastapi import APIRouter, Depends, HTTPException, Query

from app.database import execute, fetch_all, fetch_one, get_db
from app.models.event import EventCreateIn, EventOut

router = APIRouter()


@router.get("/events", response_model=list[EventOut])
async def list_events(
    category: Optional[str] = Query(None),
    db: aiosqlite.Connection = Depends(get_db),
) -> list[EventOut]:
    if category:
        rows = await fetch_all(
            db,
            """
            SELECT * FROM events
            WHERE category = ?
            ORDER BY datetime(created_at) DESC, id DESC
            """,
            (category.strip(),),
        )
    else:
        rows = await fetch_all(
            db,
            """
            SELECT * FROM events
            ORDER BY datetime(created_at) DESC, id DESC
            """,
        )
    return [EventOut(**r) for r in rows]


@router.post("/events", response_model=EventOut)
async def create_event(
    body: EventCreateIn,
    db: aiosqlite.Connection = Depends(get_db),
) -> EventOut:
    event_date = body.date or date.today().isoformat()
    eid = await execute(
        db,
        """
        INSERT INTO events (date, title, description, category, source)
        VALUES (?, ?, ?, ?, ?)
        """,
        (
            event_date,
            body.title,
            body.description,
            body.category,
            body.source or "manual",
        ),
    )
    row = await fetch_one(db, "SELECT * FROM events WHERE id = ?", (eid,))
    if row is None:
        raise HTTPException(status_code=500, detail="Failed to read created event")
    return EventOut(**row)


@router.delete("/events/{event_id}")
async def delete_event(
    event_id: int,
    db: aiosqlite.Connection = Depends(get_db),
) -> dict[str, bool]:
    row = await fetch_one(db, "SELECT id FROM events WHERE id = ?", (event_id,))
    if row is None:
        raise HTTPException(status_code=404, detail="Event not found")
    await execute(db, "DELETE FROM events WHERE id = ?", (event_id,))
    return {"ok": True}
