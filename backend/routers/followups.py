from __future__ import annotations

import logging

from fastapi import APIRouter

from database import fetch_all, get_db
from schemas import FollowupOut

logger = logging.getLogger("followups")

router = APIRouter()


@router.get("/followups", response_model=list[FollowupOut])
def list_followups() -> list[FollowupOut]:
    with get_db() as conn:
        rows = fetch_all(
            conn,
            """
            SELECT id, event_text, followup_date, question, status, created_at
            FROM followups
            ORDER BY date(followup_date) DESC, id DESC
            """,
        )

    return [
        FollowupOut(
            id=int(row["id"]),
            event_text=str(row["event_text"]),
            followup_date=str(row["followup_date"]),
            question=str(row["question"]),
            status=str(row.get("status") or "pending"),
            created_at=row.get("created_at"),
        )
        for row in rows
    ]
