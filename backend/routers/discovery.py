from __future__ import annotations

from fastapi import APIRouter

from database import get_db
from schemas import DiscoveryGapOut, DiscoveryGapsListOut
from services.discovery import get_all_gaps

router = APIRouter()


@router.get("/discovery/gaps", response_model=DiscoveryGapsListOut)
def list_discovery_gaps() -> DiscoveryGapsListOut:
    """All discovery gaps — what AIRCH knows and still needs to learn."""
    with get_db() as conn:
        rows = get_all_gaps(conn)
    gaps = [
        DiscoveryGapOut(
            id=int(row["id"]),
            category=str(row["category"]),
            question_hint=str(row["question_hint"]),
            priority=int(row.get("priority") or 2),
            status=str(row.get("status") or "open"),
            learned_value=row.get("learned_value"),
            last_asked=row.get("last_asked"),
            created_at=row.get("created_at"),
            updated_at=row.get("updated_at"),
        )
        for row in rows
    ]
    return DiscoveryGapsListOut(gaps=gaps)
