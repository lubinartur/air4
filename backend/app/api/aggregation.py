"""Time aggregation: rebuild daily, weekly, and monthly layers for a date."""

from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db import get_db
from app.services import aggregation_service

router = APIRouter()


@router.post("/time/rebuild/{day}")
def post_rebuild(day: date, db: Session = Depends(get_db)) -> dict:
    full = aggregation_service.rebuild_day(db, day)
    return {
        "daily_summary": full["daily_summary"],
        "weekly_reflection": full["weekly_reflection"],
        "monthly_summary": full["monthly_summary"],
    }
