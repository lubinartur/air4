from __future__ import annotations

from fastapi import APIRouter

from database import get_db
from schemas import SummaryOut
from services.summary_loader import load_summary

router = APIRouter()


@router.get("/summary", response_model=SummaryOut)
def get_summary() -> SummaryOut:
    """
    Summary for the period of the most recently uploaded statement.
    total_spent and by_category exclude internal transfers (is_internal_transfer = 0).
    """
    with get_db() as conn:
        return load_summary(conn)
