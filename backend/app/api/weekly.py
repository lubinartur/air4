"""Weekly time-layer API."""

from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db import get_db
from app.services import weekly_service

router = APIRouter()


@router.post("/time/weekly/{week_start}")
def post_weekly_reflection(week_start: date, db: Session = Depends(get_db)) -> dict:
    row = weekly_service.generate_weekly_reflection(db, week_start)
    return weekly_service.weekly_reflection_to_dict(row)


@router.get("/time/weekly/{week_start}")
def get_weekly_reflection(week_start: date, db: Session = Depends(get_db)) -> dict:
    row = weekly_service.get_weekly_reflection(db, week_start)
    if row is None:
        raise HTTPException(status_code=404, detail="Weekly reflection not found for this week_start.")
    return weekly_service.weekly_reflection_to_dict(row)
