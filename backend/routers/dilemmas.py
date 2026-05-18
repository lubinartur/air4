from __future__ import annotations

from fastapi import APIRouter

from database import fetch_all, get_db
from schemas import DilemmaOut

router = APIRouter()


@router.get("/dilemmas", response_model=list[DilemmaOut])
def list_dilemmas() -> list[DilemmaOut]:
    with get_db() as conn:
        rows = fetch_all(
            conn,
            """
            SELECT
                id, title, description, options, analysis, recommendation,
                status, followup_due, followup_done, followup_answer, created_at
            FROM dilemmas
            ORDER BY datetime(created_at) DESC, id DESC
            """,
        )
    return [DilemmaOut(**r) for r in rows]
