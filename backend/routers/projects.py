from __future__ import annotations

from fastapi import APIRouter

from database import fetch_all, get_db
from schemas import ProjectOut

router = APIRouter()


@router.get("/projects", response_model=list[ProjectOut])
def list_projects() -> list[ProjectOut]:
    with get_db() as conn:
        rows = fetch_all(
            conn,
            """
            SELECT id, name, description, status, started_at, created_at, updated_at
            FROM projects
            ORDER BY
              CASE status
                WHEN 'active' THEN 0
                WHEN 'paused' THEN 1
                WHEN 'stalled' THEN 2
                WHEN 'completed' THEN 3
                WHEN 'archived' THEN 4
                ELSE 99
              END,
              datetime(updated_at) DESC,
              id DESC
            """,
        )
    return [ProjectOut(**r) for r in rows]
