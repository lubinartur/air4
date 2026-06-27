from __future__ import annotations

import logging

from fastapi import APIRouter

from database import get_db
from schemas import RecommendationFeedbackOut
from services.recommendation_feedback import list_all_feedback

logger = logging.getLogger("feedback")

router = APIRouter()


@router.get("/feedback", response_model=list[RecommendationFeedbackOut])
def list_recommendation_feedback() -> list[RecommendationFeedbackOut]:
    """All recommendation feedback rows, newest first (Mirror page prep)."""
    with get_db() as conn:
        rows = list_all_feedback(conn)

    return [
        RecommendationFeedbackOut(
            id=int(row["id"]),
            recommendation=str(row.get("recommendation") or ""),
            domain=(str(row["domain"]) if row.get("domain") is not None else None),
            context=(str(row["context"]) if row.get("context") is not None else None),
            expected_action=(
                str(row["expected_action"])
                if row.get("expected_action") is not None
                else None
            ),
            follow_up_date=str(row.get("follow_up_date") or ""),
            status=str(row.get("status") or "pending"),
            user_feedback=(
                str(row["user_feedback"])
                if row.get("user_feedback") is not None
                else None
            ),
            outcome=(str(row["outcome"]) if row.get("outcome") is not None else None),
            confidence_delta=float(row.get("confidence_delta") or 0),
            created_at=row.get("created_at"),
            updated_at=row.get("updated_at"),
        )
        for row in rows
    ]
