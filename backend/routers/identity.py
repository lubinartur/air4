from __future__ import annotations

import logging

from fastapi import APIRouter

from database import fetch_all, get_db
from schemas import IdentityOut

logger = logging.getLogger("identity")

router = APIRouter()


@router.get("/identity", response_model=list[IdentityOut])
def list_identity_insights() -> list[IdentityOut]:
    with get_db() as conn:
        rows = fetch_all(
            conn,
            """
            SELECT id, category, insight, confidence, evidence_count,
                   created_at, updated_at
            FROM identity_model
            ORDER BY datetime(updated_at) DESC, id DESC
            """,
        )

    return [
        IdentityOut(
            id=int(row["id"]),
            category=str(row["category"]),
            insight=str(row["insight"]),
            confidence=float(row.get("confidence") or 0.5),
            evidence_count=int(row.get("evidence_count") or 1),
            created_at=row.get("created_at"),
            updated_at=row.get("updated_at"),
        )
        for row in rows
    ]
